/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript */
import assert from 'node:assert/strict'
export async function exerciseCookie({
  evaluate,
  getCookies,
  getOtherCookies,
  removeCookie,
  readClipboard,
  resetClipboard,
  url
}) {
  async function wait(read, reason) {
    const end = Date.now() + 6000
    do {
      const v = await read()
      if (v) return v
      await new Promise((ok) => setTimeout(ok, 50))
    } while (Date.now() < end)
    throw new Error(reason)
  }
  const cookie = (name) => getCookies({ url, name })
  const readyList = () =>
    wait(
      () =>
        evaluate(
          "document.querySelectorAll('#cookie-container > *').length===1 && document.getElementById('cookie-container').style.transition==='' && !document.querySelector('form.create,form.import')"
        ),
      'Cookie列表过渡未结束'
    )
  await wait(
    () =>
      evaluate(
        "document.body.innerText.includes('msb_fixture') && document.querySelectorAll('#cookie-container > *').length===1"
      ),
    '原Cookie列表未就绪'
  )
  await readyList()
  await evaluate("document.getElementById('create-cookie').click()")
  await wait(
    () => evaluate("document.forms.length===1 && document.forms[0].classList.contains('create')"),
    '新建表单未就绪'
  )
  await evaluate(
    "document.getElementById('name-create').value='msb_created';document.getElementById('value-create').value='created-A';document.getElementById('save-create-cookie').click()"
  )
  await wait(async () => (await cookie('msb_created'))[0]?.value === 'created-A', '新建未写入')
  if (getOtherCookies)
    assert.equal((await getOtherCookies({ url, name: 'msb_created' })).length, 0, '新建跨分区')
  await wait(
    () => evaluate("!!document.querySelector('li[data-name=msb_created] .header')"),
    '新Cookie列表缺失'
  )
  await readyList()
  await evaluate("document.querySelector('li[data-name=msb_created] .header').click()")
  await wait(
    () => evaluate("!!document.querySelector('li[data-name=msb_created] textarea[name=value]')"),
    '编辑表单缺失'
  )
  await evaluate(
    "{const li=document.querySelector('li[data-name=msb_created]');li.querySelector('textarea[name=value]').value='updated-A';li.querySelector('.save').click()}"
  )
  await wait(async () => (await cookie('msb_created'))[0]?.value === 'updated-A', '修改未写入')
  await evaluate("document.querySelector('li[data-name=msb_created] .delete').click()")
  await wait(async () => (await cookie('msb_created')).length === 0, '删除未生效')
  await readyList()
  await evaluate("document.getElementById('import-cookies').click()")
  await wait(
    () =>
      evaluate(
        "!!document.querySelector('form.import') && !document.querySelector('form.create') && document.querySelectorAll('#cookie-container > *').length===1"
      ),
    '导入表单未就绪'
  )
  const json = JSON.stringify([
    {
      domain: 'localhost',
      path: '/',
      name: 'msb_imported',
      value: 'imported-A',
      hostOnly: true,
      httpOnly: false,
      secure: false,
      session: true,
      sameSite: 'lax'
    }
  ])
  await evaluate(
    `document.querySelector('form.import textarea').value=${JSON.stringify(json)};document.getElementById('save-import-cookie').click()`
  )
  await wait(async () => (await cookie('msb_imported'))[0]?.value === 'imported-A', '导入未生效')
  await wait(
    () =>
      evaluate(
        "!document.querySelector('form.import') && document.querySelectorAll('#cookie-container > *').length===1 && !!document.querySelector('li[data-name=msb_imported]')"
      ),
    '导入列表未就绪'
  )
  await readyList()
  await resetClipboard()
  await evaluate("document.getElementById('export-cookies').click()")
  if (await evaluate("!!document.getElementById('export-json')"))
    await evaluate("document.getElementById('export-json').click()")
  const exported = await wait(async () => {
    try {
      const data = JSON.parse(await readClipboard())
      return data.some((c) => c.name === 'msb_imported' && c.value === 'imported-A') ? data : false
    } catch {
      return false
    }
  }, 'JSON未导出到剪贴板')
  assert(
    exported.some((c) => c.name === 'msb_fixture' && c.value === 'A'),
    '导出并非目标A'
  )
  if (getOtherCookies) {
    assert.equal((await getOtherCookies({ url, name: 'msb_imported' })).length, 0, '导入跨分区')
    assert.equal(
      (await getOtherCookies({ url, name: 'msb_fixture' }))[0]?.value,
      'B',
      '污染B原Cookie'
    )
  }
  assert.equal((await cookie('msb_fixture'))[0]?.value, 'A', '污染A原Cookie')
  await removeCookie(url, 'msb_imported')
  return {
    created: true,
    updated: true,
    deleted: true,
    imported: true,
    exported: true,
    isolated: getOtherCookies ? true : 'Chrome默认profile未做分区对照',
    exportCount: exported.length
  }
}
