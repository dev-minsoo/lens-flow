const path = require("path");
const mode = process.env.NODE_ENV || "production";

const baseConfig = {
  context: __dirname,
  mode,
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.s?css$/,
        use: [
          "style-loader",
          "css-loader",
          {
            loader: "sass-loader",
            options: {
              api: "modern",
            },
          },
        ],
      },
    ],
  },
  externals: [
    {
      "@k8slens/extensions": "var global.LensExtensions",
      "react": "var global.React",
      "mobx": "var global.Mobx",
      "mobx-react": "var global.MobxReact",
    },
  ],
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  output: {
    libraryTarget: "commonjs2",
    globalObject: "this",
    path: path.resolve(__dirname, "dist"),
    chunkFilename: "chunks/[name].js",
  },
  node: {
    __dirname: false,
    __filename: false,
  },
};

module.exports = [
  {
    ...baseConfig,
    entry: "./main.ts",
    target: "electron-main",
    output: {
      ...baseConfig.output,
      filename: "main.js",
    },
  },
  {
    ...baseConfig,
    entry: "./renderer.tsx",
    target: "electron-renderer",
    output: {
      ...baseConfig.output,
      filename: "renderer.js",
    },
  },
];
