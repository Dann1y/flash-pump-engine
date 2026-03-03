import { createMiddleware } from "hono/factory";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { getEnv } from "@flash-pump/shared";
import { createHmac } from "crypto";

const COOKIE_NAME = "flash_pump_session";
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours

function getSecret(): string {
  return getEnv().DASHBOARD_COOKIE_SECRET ?? "flash-pump-default-secret-change-me";
}

function signToken(value: string): string {
  const hmac = createHmac("sha256", getSecret());
  hmac.update(value);
  return `${value}.${hmac.digest("hex")}`;
}

function verifyToken(token: string): boolean {
  const lastDot = token.lastIndexOf(".");
  if (lastDot === -1) return false;
  const value = token.slice(0, lastDot);
  return signToken(value) === token;
}

export function createSession(password: string): string | null {
  const expected = getEnv().DASHBOARD_PASSWORD;
  if (!expected) return null;
  if (password !== expected) return null;
  const payload = `authenticated:${Date.now()}`;
  return signToken(payload);
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const password = getEnv().DASHBOARD_PASSWORD;

  // If no password is set, skip auth
  if (!password) {
    await next();
    return;
  }

  const path = new URL(c.req.url).pathname;

  // Allow login page and POST
  if (path === "/login") {
    await next();
    return;
  }

  const session = getCookie(c, COOKIE_NAME);
  if (!session || !verifyToken(session)) {
    return c.redirect("/login");
  }

  await next();
});

export function setSessionCookie(c: any, token: string): void {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

export function clearSessionCookie(c: any): void {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}
