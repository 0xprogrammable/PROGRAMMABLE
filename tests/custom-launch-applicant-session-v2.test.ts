import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  acquireCurrentCustomLaunchWebsiteSessionV2,
  assertCurrentCustomLaunchPrincipalV2,
  customApplicationHasDurableApprovalV2,
  customApplicationHasCurrentLaunchEntitlementV2,
  customLaunchApplicantRecoveryV2,
  customLaunchApplicantSessionBoundaryKeyV2,
  runCurrentCustomLaunchApplicantSequenceV2,
  CustomLaunchApplicantBoundaryGuardV2,
  CustomLaunchApplicantSingleFlightV2,
  CustomLaunchApplicantSessionErrorV2,
  type CustomLaunchApplicantAuthStateV2,
} from "../lib/custom-launch/applicant-session-v2";
import {
  createCustomLaunchWebsiteClientV2,
  CustomLaunchWebsiteRequestErrorV2,
} from "../lib/custom-launch/client-v2";
import type { PrincipalCustomLaunchApplicationSummaryV2 } from "../lib/custom-launch/contract-v2";

const digest = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const applicationHandle = `github-${"a".repeat(64)}` as const;
const walletAccount = `0x${"1".repeat(40)}`;
const otherWalletAccount = `0x${"2".repeat(40)}`;
const githubUserId = "123456789";

function applicantAuthState(
  overrides: Partial<CustomLaunchApplicantAuthStateV2> = {},
): CustomLaunchApplicantAuthStateV2 {
  return {
    authReady: true,
    authenticated: true,
    githubConnected: true,
    githubUserId,
    walletAccount,
    ...overrides,
  };
}

function sessionInput(
  overrides: Partial<Parameters<typeof acquireCurrentCustomLaunchWebsiteSessionV2>[0]> = {},
): Parameters<typeof acquireCurrentCustomLaunchWebsiteSessionV2>[0] {
  return {
    expectedGithubUserId: githubUserId,
    expectedWalletAccount: walletAccount,
    getAccessToken: async () => "access-current",
    getIdentityToken: async () => "identity-current",
    readApplicantAuthState: applicantAuthState,
    isCurrent: () => true,
    ...overrides,
  };
}

function dangerousSequenceEffects() {
  return {
    createChallenge: vi.fn(async () => "challenge"),
    bindPreparation: vi.fn(async () => "preparation"),
    signLaunchMessage: vi.fn(async () => "wallet-proof"),
    authenticateWallet: vi.fn(async () => "authentication"),
    authorizeLaunch: vi.fn(async () => "authorization"),
    createExecutionPreparation: vi.fn(async () => "execution"),
    sendBrowserWalletAction: vi.fn(async () => "send"),
  };
}

function approvedApplication(): PrincipalCustomLaunchApplicationSummaryV2 {
  return {
    applicationId: "application-1",
    applicationHandle,
    revisionId: "revision-1",
    repositoryId: "123",
    repositoryOwnerId: "309941960",
    repositoryFullName: "builder/project",
    pullRequestNumber: 7,
    commitOid: "a".repeat(40),
    treeOid: "b".repeat(40),
    state: "approved",
    reasonCodes: [],
    actionCodes: [],
    correctionCount: 0,
    correctionPreview: [],
    receiptDigest: digest("1"),
    launchEntitlementBindingHash: digest("2"),
    updatedAt: "2026-08-10T12:00:00.000Z",
  };
}

function applicationList(githubPrincipalHash = digest("3")) {
  return {
    schemaVersion: "programmable.principal-custom-launch-application-list.v3",
    subject: {
      provider: "github",
      githubUserId: "123456789",
      githubPrincipalHash,
    },
    applications: [approvedApplication()],
    nextCursor: null,
  };
}

describe("custom launch applicant session currentness", () => {
  it("runs the production dangerous stages only in the fixed boundary-gated order", async () => {
    const effects = dangerousSequenceEffects();
    const stages: string[] = [];
    for (const [name, effect] of Object.entries(effects)) {
      effect.mockImplementation(async () => {
        stages.push(name);
        return name;
      });
    }

    await runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async (stage) => {
        stages.push(`refresh:${stage}`);
      },
      assertBoundary: () => {
        stages.push("assert");
      },
      ...effects,
    });

    expect(stages.filter((stage) => stage.startsWith("refresh:"))).toEqual([
      "refresh:challenge",
      "refresh:preparation",
      "refresh:wallet-signature",
      "refresh:wallet-authentication",
      "refresh:authorization",
      "refresh:execution",
      "refresh:wallet-send",
    ]);
    expect(stages.filter((stage) => !stage.startsWith("refresh:") && stage !== "assert"))
      .toEqual([
        "createChallenge",
        "bindPreparation",
        "signLaunchMessage",
        "authenticateWallet",
        "authorizeLaunch",
        "createExecutionPreparation",
        "sendBrowserWalletAction",
      ]);
  });

  it("returns a broadcast for durable recovery when the boundary changes during send", async () => {
    const effects = dangerousSequenceEffects();
    const persistBroadcast = vi.fn();
    let current = true;
    effects.sendBrowserWalletAction.mockImplementation(async () => {
      current = false;
      persistBroadcast("0xtransaction");
      return "0xtransaction";
    });

    await expect(runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => undefined,
      assertBoundary: () => {
        if (!current) throw new Error("superseded boundary");
      },
      ...effects,
    })).resolves.toMatchObject({ send: "0xtransaction" });
    expect(persistBroadcast).toHaveBeenCalledWith("0xtransaction");
    expect(effects.sendBrowserWalletAction).toHaveBeenCalledOnce();
  });

  it("acquires imperative Identity then current Access within one exact auth boundary", async () => {
    const calls: string[] = [];
    const getAccessToken = vi.fn(async () => {
      calls.push("access");
      return "access-current";
    });
    const getIdentityToken = vi.fn(async () => {
      calls.push("identity");
      return "identity-current";
    });

    await expect(acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
      getAccessToken,
      getIdentityToken,
    }))).resolves.toEqual({
      accessToken: "access-current",
      identityToken: "identity-current",
    });
    expect(calls).toEqual(["identity", "access"]);
  });

  it("fails closed when identity is visible but the refreshed token is null", async () => {
    const getIdentityToken = vi.fn(async () => null);
    const downstream = vi.fn();

    const getAccessToken = vi.fn(async () => "access-current");
    await expect(acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
      getAccessToken,
      getIdentityToken,
    })).then(downstream)).rejects.toMatchObject({
      reason: "authentication",
      message: "Reconnect GitHub to continue",
    });
    expect(getIdentityToken).toHaveBeenCalledOnce();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(downstream).not.toHaveBeenCalled();
  });

  it("keeps the production dangerous sequence at zero effects for token-null", async () => {
    const effects = dangerousSequenceEffects();
    await expect(runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => {
        await acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
          getIdentityToken: async () => null,
        }));
      },
      assertBoundary: () => undefined,
      ...effects,
    })).rejects.toMatchObject({ reason: "authentication" });
    for (const effect of Object.values(effects)) {
      expect(effect).not.toHaveBeenCalled();
    }
  });

  it("sanitizes refresh failure and never starts the Website request", async () => {
    const fetchV2 = vi.fn();
    const client = createCustomLaunchWebsiteClientV2({
      getSession: () => acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
        getAccessToken: async () => "access-current",
        getIdentityToken: async () => {
          throw new Error("provider detail must not cross");
        },
      })),
      fetch: fetchV2 as typeof fetch,
    });

    await expect(client.applications()).rejects.toEqual(
      new CustomLaunchApplicantSessionErrorV2(
        "authentication",
        "Reconnect GitHub to continue",
      ),
    );
    expect(fetchV2).not.toHaveBeenCalled();
  });

  it("keeps refresh failure before challenge, permit and send", async () => {
    const effects = dangerousSequenceEffects();
    await expect(runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => {
        await acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
          getIdentityToken: async () => {
            throw new Error("provider detail must not cross");
          },
        }));
      },
      assertBoundary: () => undefined,
      ...effects,
    })).rejects.toMatchObject({ reason: "authentication" });
    for (const effect of Object.values(effects)) {
      expect(effect).not.toHaveBeenCalled();
    }
  });

  it("aborts a token sequence when auth, account, or wallet generation changes", async () => {
    let current = true;
    const getAccessToken = vi.fn(async () => "access-current");

    await expect(acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
      getAccessToken,
      getIdentityToken: async () => {
        current = false;
        return "identity-old-boundary";
      },
      isCurrent: () => current,
    }))).rejects.toMatchObject({ reason: "superseded" });
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("rejects a wrong numeric GitHub principal or launch wallet before token I/O", async () => {
    for (const state of [
      applicantAuthState({ githubUserId: "987654321" }),
      applicantAuthState({ walletAccount: otherWalletAccount }),
    ]) {
      const getIdentityToken = vi.fn(async () => "identity-current");
      const getAccessToken = vi.fn(async () => "access-current");
      const effects = dangerousSequenceEffects();
      await expect(runCurrentCustomLaunchApplicantSequenceV2({
        refreshBoundary: async () => {
          await acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
            getAccessToken,
            getIdentityToken,
            readApplicantAuthState: () => state,
          }));
        },
        assertBoundary: () => undefined,
        ...effects,
      })).rejects.toMatchObject({ reason: "superseded" });
      expect(getIdentityToken).not.toHaveBeenCalled();
      expect(getAccessToken).not.toHaveBeenCalled();
      for (const effect of Object.values(effects)) {
        expect(effect).not.toHaveBeenCalled();
      }
    }
  });

  it("rejects principal drift between refreshed Identity and Access", async () => {
    const states = [
      applicantAuthState(),
      applicantAuthState({
        githubUserId: "987654321",
        walletAccount: otherWalletAccount,
      }),
    ];
    const effects = dangerousSequenceEffects();
    await expect(runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => {
        await acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
          readApplicantAuthState: () => states.shift() ?? states[0]!,
        }));
      },
      assertBoundary: () => undefined,
      ...effects,
    })).rejects.toMatchObject({ reason: "superseded" });
    for (const effect of Object.values(effects)) {
      expect(effect).not.toHaveBeenCalled();
    }
  });

  it("stops before signature, permit, execution and send when a later refresh is stale", async () => {
    const effects = dangerousSequenceEffects();
    await expect(runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async (stage) => {
        await acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
          getIdentityToken: async () =>
            stage === "wallet-signature" ? null : "identity-current",
        }));
      },
      assertBoundary: () => undefined,
      ...effects,
    })).rejects.toMatchObject({ reason: "authentication" });
    expect(effects.createChallenge).toHaveBeenCalledOnce();
    expect(effects.bindPreparation).toHaveBeenCalledOnce();
    expect(effects.signLaunchMessage).not.toHaveBeenCalled();
    expect(effects.authenticateWallet).not.toHaveBeenCalled();
    expect(effects.authorizeLaunch).not.toHaveBeenCalled();
    expect(effects.createExecutionPreparation).not.toHaveBeenCalled();
    expect(effects.sendBrowserWalletAction).not.toHaveBeenCalled();
  });

  it("invalidates a deferred flow at the commit boundary before any dangerous stage", async () => {
    let resolveIdentity!: (value: string) => void;
    const identity = new Promise<string>((resolve) => {
      resolveIdentity = resolve;
    });
    const oldBoundary = customLaunchApplicantSessionBoundaryKeyV2({
      authReady: true,
      authenticated: true,
      githubConnected: true,
      githubUserId,
      walletAccount,
    });
    const newBoundary = customLaunchApplicantSessionBoundaryKeyV2({
      authReady: true,
      authenticated: true,
      githubConnected: true,
      githubUserId: "987654321",
      walletAccount: otherWalletAccount,
    });
    const guard = new CustomLaunchApplicantBoundaryGuardV2(oldBoundary);
    const snapshot = guard.snapshot(oldBoundary);
    const effects = dangerousSequenceEffects();
    const flow = runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => {
        await acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
          getAccessToken: async () => "access-current",
          getIdentityToken: async () => identity,
          isCurrent: () => guard.isCurrent(snapshot),
        }));
      },
      assertBoundary: () => {
        if (!guard.isCurrent(snapshot)) {
          throw new CustomLaunchApplicantSessionErrorV2(
            "superseded",
            "Your account or wallet changed",
          );
        }
      },
      ...effects,
    });

    // CustomLaunchExperience commits this guard from its root callback ref,
    // before a superseded render can yield to passive effects or interaction.
    expect(guard.commit(newBoundary)).toBe(true);
    resolveIdentity("identity-for-old-boundary");

    await expect(flow).rejects.toMatchObject({ reason: "superseded" });
    for (const effect of Object.values(effects)) {
      expect(effect).not.toHaveBeenCalled();
    }
  });

  it("does not let a stale finally release a newer single-flight owner", async () => {
    const lock = new CustomLaunchApplicantSingleFlightV2();
    const staleOwner = lock.acquire();
    expect(staleOwner).not.toBeNull();
    expect(lock.acquire()).toBeNull();

    lock.release(staleOwner!);
    const currentOwner = lock.acquire();
    expect(currentOwner).not.toBeNull();

    let resolveChallenge!: () => void;
    const challenge = new Promise<void>((resolve) => {
      resolveChallenge = resolve;
    });
    const createChallenge = vi.fn(async () => challenge);
    const authorizeLaunch = vi.fn();
    const sendBrowserWalletAction = vi.fn();
    const currentFlow = (async () => {
      await createChallenge();
      await authorizeLaunch();
      await sendBrowserWalletAction();
    })();

    // The old flow settles after the current owner has acquired the lock.
    lock.release(staleOwner!);
    expect(lock.active).toBe(true);
    expect(lock.acquire()).toBeNull();
    expect(createChallenge).toHaveBeenCalledOnce();
    expect(authorizeLaunch).not.toHaveBeenCalled();
    expect(sendBrowserWalletAction).not.toHaveBeenCalled();
    resolveChallenge();
    await currentFlow;
    lock.release(currentOwner!);
  });

  it("does not cache a session across reload or resume requests", async () => {
    let generation = 0;
    const headers: string[] = [];
    const getSession = vi.fn(async () => {
      generation += 1;
      return {
        accessToken: `access-${generation}`,
        identityToken: `identity-${generation}`,
      };
    });
    const client = createCustomLaunchWebsiteClientV2({
      getSession,
      fetch: vi.fn(async (_path, init) => {
        const requestHeaders = new Headers(init?.headers);
        headers.push(
          `${requestHeaders.get("authorization")}/${requestHeaders.get("x-privy-identity-token")}`,
        );
        return new Response(JSON.stringify(applicationList()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });

    const effects = dangerousSequenceEffects();
    effects.createChallenge.mockImplementation(async () => {
      await client.applications();
      return "challenge";
    });
    const run = () => runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => undefined,
      assertBoundary: () => undefined,
      ...effects,
    });

    await run();
    await run();

    expect(getSession).toHaveBeenCalledTimes(2);
    expect(headers).toEqual([
      "Bearer access-1/identity-1",
      "Bearer access-2/identity-2",
    ]);
  });

  it("stops before permit or send when the server rejects a stale session", async () => {
    const client = createCustomLaunchWebsiteClientV2({
      getSession: async () => ({
        accessToken: "access-current",
        identityToken: "identity-stale",
      }),
      fetch: vi.fn(async () => new Response(JSON.stringify({
        schemaVersion: "programmable.custom-launch-website-error.v2",
        code: "applicant_authentication_required",
        message: "Authentication required",
      }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as typeof fetch,
    });

    const effects = dangerousSequenceEffects();
    effects.createChallenge.mockImplementation(async () => {
      await client.applications();
      return "challenge";
    });
    await expect(runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => undefined,
      assertBoundary: () => undefined,
      ...effects,
    })).rejects.toMatchObject({
      status: 401,
      code: "applicant_authentication_required",
    });
    expect(effects.createChallenge).toHaveBeenCalledOnce();
    expect(effects.bindPreparation).not.toHaveBeenCalled();
    expect(effects.authorizeLaunch).not.toHaveBeenCalled();
    expect(effects.sendBrowserWalletAction).not.toHaveBeenCalled();
  });

  it("rejects a wrong GitHub principal before downstream launch work", async () => {
    const effects = dangerousSequenceEffects();
    await expect(runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => {
        assertCurrentCustomLaunchPrincipalV2(digest("3"), digest("4"));
      },
      assertBoundary: () => undefined,
      ...effects,
    })).rejects.toThrow("Reconnect the GitHub account that opened this submission");
    for (const effect of Object.values(effects)) {
      expect(effect).not.toHaveBeenCalled();
    }
  });

  it("keeps durable approval separate from transient recovery state", () => {
    const approved = approvedApplication();
    expect(customApplicationHasCurrentLaunchEntitlementV2(approved)).toBe(true);
    expect(customApplicationHasDurableApprovalV2(approved)).toBe(false);
    expect(customApplicationHasDurableApprovalV2(approved, "ACTIVE")).toBe(true);
    expect(customApplicationHasCurrentLaunchEntitlementV2({
      ...approved,
      receiptDigest: null,
    })).toBe(false);
    expect(customApplicationHasCurrentLaunchEntitlementV2({
      ...approved,
      launchEntitlementBindingHash: null,
    })).toBe(false);
    expect(customLaunchApplicantRecoveryV2(
      new CustomLaunchWebsiteRequestErrorV2(503, "provider_unavailable"),
    )).toBe("retry");
    expect(customLaunchApplicantRecoveryV2(
      new CustomLaunchWebsiteRequestErrorV2(401, "applicant_authentication_required"),
    )).toBe("reconnect-github");
  });

  it("recovers with a fresh session after a temporary provider failure", async () => {
    let unavailable = true;
    let sessionGeneration = 0;
    const client = createCustomLaunchWebsiteClientV2({
      getSession: async () => {
        sessionGeneration += 1;
        return {
          accessToken: `access-${sessionGeneration}`,
          identityToken: `identity-${sessionGeneration}`,
        };
      },
      fetch: vi.fn(async () => unavailable
        ? new Response(JSON.stringify({
            schemaVersion: "programmable.custom-launch-website-error.v2",
            code: "provider_unavailable",
            message: "Temporarily unavailable",
          }), {
            status: 503,
            headers: { "content-type": "application/json" },
          })
        : new Response(JSON.stringify(applicationList()), {
            status: 200,
            headers: { "content-type": "application/json" },
          })) as typeof fetch,
    });
    const effects = dangerousSequenceEffects();
    effects.createChallenge.mockImplementation(async () => {
      await client.applications();
      return "challenge";
    });
    const run = () => runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => undefined,
      assertBoundary: () => undefined,
      ...effects,
    });

    await expect(run()).rejects.toMatchObject({ status: 503 });
    expect(effects.bindPreparation).not.toHaveBeenCalled();
    expect(effects.authorizeLaunch).not.toHaveBeenCalled();
    expect(effects.sendBrowserWalletAction).not.toHaveBeenCalled();
    expect(customApplicationHasCurrentLaunchEntitlementV2(approvedApplication())).toBe(true);
    expect(customApplicationHasDurableApprovalV2(approvedApplication())).toBe(false);
    unavailable = false;
    await expect(run()).resolves.toMatchObject({
      challenge: "challenge",
      send: "send",
    });
    expect(effects.authorizeLaunch).toHaveBeenCalledOnce();
    expect(effects.sendBrowserWalletAction).toHaveBeenCalledOnce();
    expect(sessionGeneration).toBe(2);
  });

  it("keeps transport and grant expiry out of Applicant-facing approval copy", () => {
    const componentSource = readFileSync(join(
      process.cwd(),
      "components/custom-launch-experience.tsx",
    ), "utf8");
    const clientSource = readFileSync(join(
      process.cwd(),
      "lib/custom-launch/client-v2.ts",
    ), "utf8");
    const walletSource = readFileSync(join(
      process.cwd(),
      "components/wallet-provider.tsx",
    ), "utf8");

    expect(componentSource).not.toContain("Approval valid until");
    expect(componentSource).not.toContain("Ready to launch");
    expect(componentSource).toContain("Approved — launch anytime");
    expect(componentSource).toContain("Launch access expired");
    expect(componentSource).toContain("ref={boundaryRef}");
    expect(componentSource).toContain("const commitSessionBoundary =");
    expect(componentSource).toContain("sessionBoundaryGuardRef.current.commit(sessionBoundaryKey)");
    expect(componentSource).toContain("createCustomLaunchWebsiteClientV2({ getSession })");
    expect(componentSource).toContain("const sequence = await runCurrentCustomLaunchApplicantSequenceV2({");
    expect(componentSource).toContain("if (isActive()) {\n        setTransactionHash(hash);");
    expect(componentSource).toContain("readApplicantAuthState,");
    expect(componentSource).toContain("await reauthorizeGithub()");
    expect(componentSource).not.toContain('from "@/components/manual-applicant-launch"');
    expect(clientSource).toContain("getSession: () => Promise<CustomLaunchWebsiteSessionV2>");
    expect(clientSource).not.toContain("session: CustomLaunchWebsiteSessionV2");
    expect(walletSource).toContain("loadIdentityToken: getPrivyIdentityToken");
    expect(walletSource).not.toContain("useIdentityToken");
  });
});
