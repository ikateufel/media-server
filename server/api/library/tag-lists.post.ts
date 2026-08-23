import { createError, readBody } from 'h3'
import { requireCatalogUnlock } from '../../utils/catalogAccess'
import {
  createTagList,
  deleteTagList,
  renameTagList,
  setTagListTags,
  toggleTagInList,
} from '../../utils/tagLists'

/**
 * POST /api/library/tag-lists
 * body.action: create | rename | delete | set-tags | toggle-tag
 */
export default defineEventHandler(async (event) => {
  requireCatalogUnlock(event)
  const body = (await readBody(event).catch(() => null)) as {
    action?: unknown
    id?: unknown
    name?: unknown
    tags?: unknown
    tag?: unknown
    inList?: unknown
  } | null

  const action = String(body?.action ?? '').trim().toLowerCase()

  try {
    if (action === 'create') {
      return await createTagList(body?.name)
    }
    if (action === 'rename') {
      return await renameTagList(body?.id, body?.name)
    }
    if (action === 'delete') {
      return await deleteTagList(body?.id)
    }
    if (action === 'set-tags') {
      return await setTagListTags(body?.id, body?.tags)
    }
    if (action === 'toggle-tag') {
      const want =
        body?.inList === undefined || body?.inList === null
          ? null
          : Boolean(body.inList)
      return await toggleTagInList(body?.id, body?.tag, want)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw createError({
      statusCode: msg.includes('não encontrada') ? 404 : 400,
      statusMessage: msg,
    })
  }

  throw createError({
    statusCode: 400,
    statusMessage: 'action inválida (create | rename | delete | set-tags | toggle-tag).',
  })
})
