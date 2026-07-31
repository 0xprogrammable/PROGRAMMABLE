import "server-only";

import { invalidInput } from "./errors";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);
const POSTGRESQL_PREFIX = "postgresql://";

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
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label),
  );
}

function validateRawAuthority(value: string): void {
  if (!value.startsWith(POSTGRESQL_PREFIX)) {
    return invalidConnectionString();
  }

  const remainder = value.slice(POSTGRESQL_PREFIX.length);
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
    rawPort !== undefined &&
    (!/^[1-9]\d{0,4}$/u.test(rawPort) || Number(rawPort) > 65_535)
  ) {
    return invalidConnectionString();
  }
}

export function validatedPostgresConnectionString(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 4_096 ||
    /[\u0000-\u0020\u007f]/u.test(value)
  ) {
    return invalidConnectionString();
  }

  validateRawAuthority(value);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalidConnectionString();
  }

  if (
    url.protocol !== "postgresql:" ||
    url.username === "" ||
    url.password === "" ||
    url.hostname === "" ||
    url.pathname === "" ||
    url.pathname === "/" ||
    url.hash !== ""
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
    return value;
  }

  if (sslModes.length !== 1 || sslModes[0] !== "verify-full") {
    return invalidConnectionString();
  }
  return value;
}
