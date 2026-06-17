import { renderHome } from './home'
import { renderCatsGame } from './games/cats/index'

const routes: Record<string, (params: URLSearchParams) => void> = {
  '': (_params) => renderHome(),
  'cats': (params) => {
    const levelParam = params.get('level')
    const parsedLevel = levelParam ? parseInt(levelParam, 10) : undefined
    renderCatsGame(Number.isFinite(parsedLevel) ? parsedLevel : undefined)
  },
}

export function initRouter(): void {
  function navigate(): void {
    const hash = window.location.hash.slice(1) // remove #
    const [path, search] = hash.split('?')
    const params = new URLSearchParams(search || '')
    const handler = Object.prototype.hasOwnProperty.call(routes, path) ? routes[path] : routes['']
    handler(params)
  }
  window.addEventListener('hashchange', navigate)
  navigate()
}

export function go(path: string, params?: Record<string, string>): void {
  const search = params ? '?' + new URLSearchParams(params).toString() : ''
  window.location.hash = path + search
}
