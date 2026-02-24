import dotenv from "dotenv";
import z from "zod";

const NODE_ENV = process.env.NODE_ENV || "development";

dotenv.config({
  path: NODE_ENV === "production" ? ".env.prod" : ".env.local",
});

const ENVSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535),
  HOST: z.string().min(1, "HOST is required"),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
});

let config: z.infer<typeof ENVSchema>;

try {
  config = ENVSchema.parse({
    ...process.env,
    NODE_ENV,
  });
  console.log(
    `[ NODE ] Environment Variables loaded successfully: ${NODE_ENV}`,
  );
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error(`❌ Invalid config (${NODE_ENV}):`);
    error.issues.forEach((err) => {
      console.error(`  - ${err.path.join(".")}: ${err.message}`);
    });
  }
  throw error;
}

export default config;
