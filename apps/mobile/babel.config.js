module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Transpila campos/métodos privados de classe (#x). O Hermes do Expo Go
    // rejeita essa sintaxe crua ("private properties are not supported") quando
    // alguma dependência a envia sem transformar.
    plugins: [
      ["@babel/plugin-transform-private-methods", { loose: true }],
      ["@babel/plugin-transform-private-property-in-object", { loose: true }],
      ["@babel/plugin-transform-class-properties", { loose: true }],
    ],
  };
};
