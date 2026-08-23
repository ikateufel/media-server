const fs = require('fs')
const { parse } = require('@vue/compiler-dom')
const t = fs.readFileSync('E:/User/Projetos/video_player/pages/index.vue', 'utf8')
const start = t.indexOf('<template>')
const end = t.lastIndexOf('</template>')
const tpl = t.slice(start + '<template>'.length, end)
try {
  parse(tpl)
  console.log('parse ok')
} catch (e) {
  console.error(e.message)
  if (e.loc) console.error(e.loc)
}
