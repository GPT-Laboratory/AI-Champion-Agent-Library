import type { LayoutServerLoad } from './$types'
import { layoutCompareData } from '$lib/compare.js'
import { THEME_COOKIE, layoutThemeData } from '$lib/theme.js'

export const load: LayoutServerLoad = async ({ locals, cookies }) => ({
  user: locals.user,
  ...layoutCompareData(),
  ...layoutThemeData(cookies?.get(THEME_COOKIE)),
})
