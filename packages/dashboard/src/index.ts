import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createLogger, getEnv } from "@flash-pump/shared";
import { authMiddleware, createSession, setSessionCookie, clearSessionCookie } from "./auth";
import { loginPage } from "./views/login";
import dashboardRoutes from "./routes/dashboard";
import tokenRoutes from "./routes/tokens";
import walletRoutes from "./routes/wallets";

const log = createLogger("dashboard");
const app = new Hono();

// Auth middleware
app.use("*", authMiddleware);

// Login routes
app.get("/login", (c) => {
  return c.html(loginPage());
});

app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const password = body.password as string;
  const token = createSession(password);

  if (!token) {
    return c.html(loginPage("Invalid password"), 401);
  }

  setSessionCookie(c, token);
  return c.redirect("/");
});

app.get("/logout", (c) => {
  clearSessionCookie(c);
  return c.redirect("/login");
});

// Mount routes
app.route("/", dashboardRoutes);
app.route("/tokens", tokenRoutes);
app.route("/wallets", walletRoutes);

// Start server
const port = parseInt(process.env.DASHBOARD_PORT ?? "3000", 10);

// Trigger env validation
getEnv();

log.info({ port }, "Starting dashboard server");

serve({ fetch: app.fetch, port }, (info) => {
  log.info({ port: info.port }, "Dashboard running");
});
