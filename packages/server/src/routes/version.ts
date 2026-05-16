import { Hono } from "hono";
import { getVersionInfo } from "../lib/version.js";

const version = new Hono();

version.get("/", async (c) => {
  const repo = process.env.UPDATE_REPO || "HaiouZh/TimeData";
  const currentSha = process.env.GIT_SHA || "dev";
  const info = await getVersionInfo({ currentSha, repo });
  return c.json(info);
});

export default version;
