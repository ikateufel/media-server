/**
 * h3 avisa (e no futuro corta) `statusMessage` com caracteres fora de ASCII.
 * O texto para o utilizador fica em `message`; o motivo HTTP fica curto e ASCII.
 */
import * as h3 from '../node_modules/h3/dist/index.mjs'

const DISALLOWED = /[^\u0009\u0020-\u007E]/

const STATUS_TEXT = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  500: 'Server Error',
  503: 'Service Unavailable',
}

export function createError(input) {
  if (input && typeof input === 'object' && !h3.isError(input)) {
    const statusMessage = input.statusMessage ?? input.statusText
    if (typeof statusMessage === 'string' && DISALLOWED.test(statusMessage)) {
      const statusCode = Number(input.statusCode ?? input.status ?? 500)
      const message =
        typeof input.message === 'string' && input.message.trim()
          ? input.message
          : statusMessage
      return h3.createError({
        ...input,
        message,
        statusMessage: STATUS_TEXT[statusCode] || 'Error',
      })
    }
  }
  return h3.createError(input)
}

export const H3Error = h3.H3Error
export const H3Event = h3.H3Event
export const H3Headers = h3.H3Headers
export const H3Response = h3.H3Response
export const MIMES = h3.MIMES
export const appendCorsHeaders = h3.appendCorsHeaders
export const appendCorsPreflightHeaders = h3.appendCorsPreflightHeaders
export const appendHeader = h3.appendHeader
export const appendHeaders = h3.appendHeaders
export const appendResponseHeader = h3.appendResponseHeader
export const appendResponseHeaders = h3.appendResponseHeaders
export const assertMethod = h3.assertMethod
export const callNodeListener = h3.callNodeListener
export const clearResponseHeaders = h3.clearResponseHeaders
export const clearSession = h3.clearSession
export const createApp = h3.createApp
export const createAppEventHandler = h3.createAppEventHandler
export const createEvent = h3.createEvent
export const createEventStream = h3.createEventStream
export const createRouter = h3.createRouter
export const defaultContentType = h3.defaultContentType
export const defineEventHandler = h3.defineEventHandler
export const defineLazyEventHandler = h3.defineLazyEventHandler
export const defineNodeListener = h3.defineNodeListener
export const defineNodeMiddleware = h3.defineNodeMiddleware
export const defineRequestMiddleware = h3.defineRequestMiddleware
export const defineResponseMiddleware = h3.defineResponseMiddleware
export const defineWebSocket = h3.defineWebSocket
export const defineWebSocketHandler = h3.defineWebSocketHandler
export const deleteCookie = h3.deleteCookie
export const dynamicEventHandler = h3.dynamicEventHandler
export const eventHandler = h3.eventHandler
export const fetchWithEvent = h3.fetchWithEvent
export const fromNodeMiddleware = h3.fromNodeMiddleware
export const fromPlainHandler = h3.fromPlainHandler
export const fromWebHandler = h3.fromWebHandler
export const getCookie = h3.getCookie
export const getHeader = h3.getHeader
export const getHeaders = h3.getHeaders
export const getMethod = h3.getMethod
export const getProxyRequestHeaders = h3.getProxyRequestHeaders
export const getQuery = h3.getQuery
export const getRequestFingerprint = h3.getRequestFingerprint
export const getRequestHeader = h3.getRequestHeader
export const getRequestHeaders = h3.getRequestHeaders
export const getRequestHost = h3.getRequestHost
export const getRequestIP = h3.getRequestIP
export const getRequestPath = h3.getRequestPath
export const getRequestProtocol = h3.getRequestProtocol
export const getRequestURL = h3.getRequestURL
export const getRequestWebStream = h3.getRequestWebStream
export const getResponseHeader = h3.getResponseHeader
export const getResponseHeaders = h3.getResponseHeaders
export const getResponseStatus = h3.getResponseStatus
export const getResponseStatusText = h3.getResponseStatusText
export const getRouterParam = h3.getRouterParam
export const getRouterParams = h3.getRouterParams
export const getSession = h3.getSession
export const getValidatedQuery = h3.getValidatedQuery
export const getValidatedRouterParams = h3.getValidatedRouterParams
export const handleCacheHeaders = h3.handleCacheHeaders
export const handleCors = h3.handleCors
export const isCorsOriginAllowed = h3.isCorsOriginAllowed
export const isError = h3.isError
export const isEvent = h3.isEvent
export const isEventHandler = h3.isEventHandler
export const isMethod = h3.isMethod
export const isPreflightRequest = h3.isPreflightRequest
export const isStream = h3.isStream
export const isWebResponse = h3.isWebResponse
export const lazyEventHandler = h3.lazyEventHandler
export const parseCookies = h3.parseCookies
export const promisifyNodeListener = h3.promisifyNodeListener
export const proxyRequest = h3.proxyRequest
export const readBody = h3.readBody
export const readFormData = h3.readFormData
export const readMultipartFormData = h3.readMultipartFormData
export const readRawBody = h3.readRawBody
export const readValidatedBody = h3.readValidatedBody
export const removeResponseHeader = h3.removeResponseHeader
export const sanitizeStatusCode = h3.sanitizeStatusCode
export const sanitizeStatusMessage = h3.sanitizeStatusMessage
export const sealSession = h3.sealSession
export const send = h3.send
export const sendError = h3.sendError
export const sendIterable = h3.sendIterable
export const sendNoContent = h3.sendNoContent
export const sendProxy = h3.sendProxy
export const sendRedirect = h3.sendRedirect
export const sendStream = h3.sendStream
export const sendWebResponse = h3.sendWebResponse
export const serveStatic = h3.serveStatic
export const setCookie = h3.setCookie
export const setHeader = h3.setHeader
export const setHeaders = h3.setHeaders
export const setResponseHeader = h3.setResponseHeader
export const setResponseHeaders = h3.setResponseHeaders
export const setResponseStatus = h3.setResponseStatus
export const splitCookiesString = h3.splitCookiesString
export const toEventHandler = h3.toEventHandler
export const toNodeListener = h3.toNodeListener
export const toPlainHandler = h3.toPlainHandler
export const toWebHandler = h3.toWebHandler
export const toWebRequest = h3.toWebRequest
export const unsealSession = h3.unsealSession
export const updateSession = h3.updateSession
export const use = h3.use
export const useBase = h3.useBase
export const useSession = h3.useSession
export const writeEarlyHints = h3.writeEarlyHints
