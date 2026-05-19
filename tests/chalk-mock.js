const passthrough = value => String(value);

const chalk = new Proxy(passthrough, {
  get: () => chalk,
  apply: (_target, _thisArg, args) => String(args[0] ?? ''),
});

module.exports = chalk;
module.exports.default = chalk;
