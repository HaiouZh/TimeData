import { Hono } from "hono";
import { getVersionInfo } from "../lib/version.js";

const version = new Hono();

version.get("/", async (c) => {
  const repo = process.env.UPDATE_REPO || "HaiouZh/TimeData";
  const currentSha = process.env.GIT_SHA || "dev";
  const force = c.req.query("refresh") === "1" || c.req.query("force") === "1";
  const info = await getVersionInfo({ currentSha, repo, force });
  return c.json(info);
});

export default version;
