import "server-only";

import { X509Certificate } from "node:crypto";

import { invalidInput } from "./errors";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);
const POSTGRES_PREFIXES = ["postgresql://", "postgres://"] as const;

function invalidConnectionString(): never {
  throw invalidInput("postgres", "connection-string");
}

function decodedConnectionComponent(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (decoded === "" || /[\u0000-\u0020\u007f]/u.test(decoded)) {
      return invalidConnectionString();
    }
    return decoded;
  } catch {
    return invalidConnectionString();
  }
}

function isCanonicalIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^(0|[1-9]\d{0,2})$/u.test(part)) return false;
      return Number(part) <= 255;
    })
  );
}

function isCanonicalDnsName(hostname: string): boolean {
  if (hostname.length > 253) return false;
  const labels = hostname.split(".");
  return labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  );
}

function validateRawAuthority(value: string): {
  prefix: (typeof POSTGRES_PREFIXES)[number];
  hostname: string;
  port: string;
} {
  const prefix = POSTGRES_PREFIXES.find((candidate) =>
    value.startsWith(candidate),
  );
  if (!prefix) return invalidConnectionString();

  const remainder = value.slice(prefix.length);
  const boundary = remainder.search(/[/?#]/u);
  if (boundary <= 0) return invalidConnectionString();

  const authority = remainder.slice(0, boundary);
  if (authority.includes(",") || authority.includes("\\")) {
    return invalidConnectionString();
  }

  const separator = authority.indexOf("@");
  if (separator <= 0 || separator !== authority.lastIndexOf("@")) {
    return invalidConnectionString();
  }

  const userInfo = authority.slice(0, separator);
  const passwordSeparator = userInfo.indexOf(":");
  if (passwordSeparator <= 0 || passwordSeparator === userInfo.length - 1) {
    return invalidConnectionString();
  }
  decodedConnectionComponent(userInfo.slice(0, passwordSeparator));
  decodedConnectionComponent(userInfo.slice(passwordSeparator + 1));

  const hostAndPort = authority.slice(separator + 1);
  let rawHostname: string;
  let rawPort: string | undefined;
  if (hostAndPort.startsWith("[")) {
    // postgres.js 3.4.x splits bracketed addresses on colons before connecting.
    // Reject them until the driver exposes an unambiguous parsed-host boundary.
    return invalidConnectionString();
  } else {
    const firstColon = hostAndPort.indexOf(":");
    if (firstColon >= 0) {
      if (firstColon !== hostAndPort.lastIndexOf(":")) {
        return invalidConnectionString();
      }
      rawHostname = hostAndPort.slice(0, firstColon);
      rawPort = hostAndPort.slice(firstColon + 1);
    } else {
      rawHostname = hostAndPort;
    }

    if (
      rawHostname.includes("%") ||
      (!isCanonicalIpv4(rawHostname) && !isCanonicalDnsName(rawHostname))
    ) {
      return invalidConnectionString();
    }
  }

  if (
    rawPort === undefined ||
    !/^[1-9]\d{0,4}$/.test(rawPort) ||
    Number(rawPort) > 65_535
  ) {
    return invalidConnectionString();
  }
  return { prefix, hostname: rawHostname, port: rawPort };
}

export type PostgresConnectionTarget = {
  connectionString: string;
  hostname: string;
  port: number;
  isLoopback: boolean;
  sslMode?: "disable" | "verify-full";
};

export function validatedPostgresConnectionTarget(
  value: unknown,
): PostgresConnectionTarget {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 4_096 ||
    /[\u0000-\u0020\u007f]/u.test(value)
  ) {
    return invalidConnectionString();
  }

  const authority = validateRawAuthority(value);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalidConnectionString();
  }

  if (
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    `${url.protocol}//` !== authority.prefix ||
    url.username === "" ||
    url.password === "" ||
    url.hostname === "" ||
    url.pathname === "" ||
    url.pathname === "/" ||
    url.hash !== "" ||
    url.hostname !== authority.hostname ||
    url.port !== authority.port
  ) {
    return invalidConnectionString();
  }

  for (const key of url.searchParams.keys()) {
    if (key !== "sslmode") {
      return invalidConnectionString();
    }
  }

  const sslModes = url.searchParams.getAll("sslmode");
  if (sslModes.length > 1) return invalidConnectionString();

  if (LOOPBACK_HOSTS.has(url.hostname)) {
    if (
      sslModes.length === 1 &&
      sslModes[0] !== "disable" &&
      sslModes[0] !== "verify-full"
    ) {
      return invalidConnectionString();
    }
    return {
      connectionString: value,
      hostname: url.hostname,
      port: Number(authority.port),
      isLoopback: true,
      sslMode: sslModes[0] as "disable" | "verify-full" | undefined,
    };
  }

  if (sslModes.length !== 1 || sslModes[0] !== "verify-full") {
    return invalidConnectionString();
  }
  return {
    connectionString: value,
    hostname: url.hostname,
    port: Number(authority.port),
    isLoopback: false,
    sslMode: "verify-full",
  };
}

export function validatedPostgresConnectionString(value: unknown): string {
  return validatedPostgresConnectionTarget(value).connectionString;
}

export function validatedPostgresSslCa(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 256 ||
    value.length > 32_768 ||
    !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\r?\n?$/.test(
      value,
    )
  ) {
    return invalidConnectionString();
  }
  try {
    new X509Certificate(value);
  } catch {
    return invalidConnectionString();
  }
  return value;
}
