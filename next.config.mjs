/** @type {import('next').NextConfig} */
const nextConfig = {
  // The T3 SDK ships a WASM component; let it be bundled for server routes.
  serverExternalPackages: ["@terminal3/t3n-sdk"],
};

export default nextConfig;
