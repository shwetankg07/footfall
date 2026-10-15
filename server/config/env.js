const REQUIRED_ENV = ["MONGO_URI", "JWT_SECRET", "CLIENT_URL", "INTERNAL_SECRET"];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}
