/**
 * O parser WASM do `source-map` rebenta com "unreachable" em mapas grandes
 * ou quando vários consumers partilham a mesma memória sem `destroy()`.
 * O formatador de erros do Nitro em dev usa isto; se rebentar, o log perde
 * o erro original.
 */
const { createRequire } = require('node:module')
const path = require('node:path')

const req = createRequire(path.join(process.cwd(), 'package.json'))
const real = req('source-map')

function emptyPosition() {
  return { source: null, line: null, column: null, name: null }
}

function SafeSourceMapConsumer(sourceMap, sourceMapUrl) {
  let pending
  try {
    pending = new real.SourceMapConsumer(sourceMap, sourceMapUrl)
  } catch {
    pending = null
  }
  return Promise.resolve(pending)
    .then((consumer) => {
      if (!consumer || typeof consumer.originalPositionFor !== 'function') {
        return {
          originalPositionFor: () => emptyPosition(),
          destroy() {},
        }
      }
      const orig = consumer.originalPositionFor.bind(consumer)
      const destroy = typeof consumer.destroy === 'function' ? consumer.destroy.bind(consumer) : () => {}
      let dead = false
      consumer.originalPositionFor = (pos) => {
        if (dead) return emptyPosition()
        try {
          return orig(pos)
        } catch {
          return emptyPosition()
        } finally {
          dead = true
          try {
            destroy()
          } catch {
            /* memória wasm já libertada ou inválida */
          }
        }
      }
      return consumer
    })
    .catch(() => ({
      originalPositionFor: () => emptyPosition(),
      destroy() {},
    }))
}

SafeSourceMapConsumer.initialize = real.SourceMapConsumer.initialize
SafeSourceMapConsumer.fromSourceMap = real.SourceMapConsumer.fromSourceMap
SafeSourceMapConsumer.with = real.SourceMapConsumer.with
for (const key of ['GREATEST_LOWER_BOUND', 'LEAST_UPPER_BOUND', 'GENERATED_ORDER', 'ORIGINAL_ORDER']) {
  if (key in real.SourceMapConsumer) SafeSourceMapConsumer[key] = real.SourceMapConsumer[key]
}

module.exports = {
  ...real,
  SourceMapConsumer: SafeSourceMapConsumer,
}
