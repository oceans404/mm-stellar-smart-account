import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't bundle @stellar/stellar-sdk into the server build — it has Node
  // native bits that confuse Next.js's "collecting page data" step. Loaded
  // at runtime in the API routes instead.
  serverExternalPackages: ['@stellar/stellar-sdk'],
  webpack: (config, { isServer, webpack }) => {
    // @stellar/stellar-sdk needs Buffer in the browser. Webpack 5 dropped
    // automatic Node builtin polyfills, so:
    //   1) resolve.fallback maps 'buffer' to the absolute path of the npm
    //      polyfill package (no trailing slash — `require.resolve('buffer')`
    //      in a project with the npm `buffer` dep returns the file path,
    //      not the bare module name).
    //   2) ProvidePlugin auto-injects `Buffer` wherever it's referenced.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        buffer: require.resolve('buffer'),
      };
      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
        }),
      );
    }
    return config;
  },
};

export default nextConfig;
