import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { getSupabaseAdmin, getSupabaseAnon } from "./lib/supabase";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(express.json());

  const messageSchema = z.object({
    message: z.string().trim().min(1).max(200),
  });

  app.get("/api/hello", async (_req, res) => {
    try {
      const { data, error } = await getSupabaseAnon()
        .from("hello")
        .select("id, message, created_at")
        .order("created_at", { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ data: data ?? [] });
    } catch (error) {
      return res
        .status(503)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "Supabase is not configured",
        });
    }
  });

  app.post("/api/hello", async (req, res) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "message must be between 1 and 200 characters" });
    try {
      const { data, error } = await getSupabaseAnon()
        .from("hello")
        .insert(parsed.data)
        .select("id, message, created_at")
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ data });
    } catch (error) {
      return res
        .status(503)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "Supabase is not configured",
        });
    }
  });

  app.get("/api/health", async (_req, res) => {
    try {
      const { error } = await getSupabaseAdmin()
        .from("hello")
        .select("id")
        .limit(1);
      if (error)
        return res
          .status(500)
          .json({ status: "error", message: error.message });
      return res.json({
        status: "ok",
        db: "connected",
        time: new Date().toISOString(),
      });
    } catch (error) {
      return res
        .status(500)
        .json({
          status: "error",
          message:
            error instanceof Error ? error.message : "Database unavailable",
        });
    }
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
