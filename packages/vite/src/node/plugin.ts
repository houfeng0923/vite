import type {
  CustomPluginOptions,
  LoadResult,
  ObjectHook,
  ResolveIdResult,
  Plugin as RollupPlugin,
  PluginContext as RollupPluginContext,
  TransformPluginContext as RollupTransformPluginContext,
  TransformResult,
} from 'rollup'
import type {
  ConfigEnv,
  EnvironmentOptions,
  ResolvedConfig,
  UserConfig,
} from './config'
import type { ServerHook, ViteDevServer } from './server'
import type { IndexHtmlTransform } from './plugins/html'
import type { EnvironmentModuleNode } from './server/moduleGraph'
import type { ModuleNode } from './server/mixedModuleGraph'
import type { HmrContext, HotUpdateContext } from './server/hmr'
import type { PreviewServerHook } from './preview'
import type { DevEnvironment } from './server/environment'
import type { BuildEnvironment } from './build'
import type { ScanEnvironment } from './optimizer/scan'

/**
 * Vite plugins extends the Rollup plugin interface with a few extra
 * vite-specific options. A valid vite plugin is also a valid Rollup plugin.
 * On the contrary, a Rollup plugin may or may NOT be a valid vite universal
 * plugin, since some Rollup features do not make sense in an unbundled
 * dev server context. That said, as long as a rollup plugin doesn't have strong
 * coupling between its bundle phase and output phase hooks then it should
 * just work (that means, most of them).
 *
 * By default, the plugins are run during both serve and build. When a plugin
 * is applied during serve, it will only run **non output plugin hooks** (see
 * rollup type definition of {@link rollup#PluginHooks}). You can think of the
 * dev server as only running `const bundle = rollup.rollup()` but never calling
 * `bundle.generate()`.
 *
 * A plugin that expects to have different behavior depending on serve/build can
 * export a factory function that receives the command being run via options.
 *
 * If a plugin should be applied only for server or build, a function format
 * config file can be used to conditional determine the plugins to use.
 *
 * The current module environment can be accessed from the context for the
 * buildStart, resolveId, transform, load, and buildEnd, hooks
 *
 * The current environment can be accessed from the context for the
 * buildStart, resolveId, transform, load, and buildEnd, hooks. It can be a dev
 * or a build environment. Plugins can use this.environment.mode === 'dev' to
 * check if they have access to dev specific APIs.
 */

export type PluginEnvironment =
  | DevEnvironment
  | BuildEnvironment
  | ScanEnvironment

export interface PluginContext extends RollupPluginContext {
  environment?: PluginEnvironment
}

export interface ResolveIdPluginContext extends RollupPluginContext {
  environment?: PluginEnvironment
}

export interface TransformPluginContext extends RollupTransformPluginContext {
  environment?: PluginEnvironment
}

/**
 * There are two types of plugins in Vite. App plugins and environment plugins.
 * Environment Plugins are defined by a constructor function that will be called
 * once per each environment allowing users to have completely different plugins
 * for each of them. The constructor gets the resolved environment after the server
 * and builder has already been created simplifying config access and cache
 * managementfor for environment specific plugins.
 * Environment Plugins are closer to regular rollup plugins. They can't define
 * app level hooks (like config, configResolved, configureServer, etc).
 */

type ModifyFunctionContext<Function_, NewContext> = Function_ extends (
  this: infer This,
  ...parameters: infer Arguments
) => infer Return
  ? (this: NewContext, ...parameters: Arguments) => Return
  : never

type ModifyObjectHookContext<
  Handler,
  Object_ extends { handler: Handler },
  NewContext,
> = Object_ & {
  handler: ModifyFunctionContext<Handler, NewContext>
}

type ModifyHookContext<Hook, NewContext> = Hook extends {
  handler: infer Handler
}
  ? ModifyObjectHookContext<Handler, Hook, NewContext>
  : ModifyFunctionContext<Hook, NewContext>

export interface BasePlugin<A = any> extends RollupPlugin<A> {
  /**
   * Enforce plugin invocation tier similar to webpack loaders. Hooks ordering
   * is still subject to the `order` property in the hook object.
   *
   * Plugin invocation order:
   * - alias resolution
   * - `enforce: 'pre'` plugins
   * - vite core plugins
   * - normal plugins
   * - vite build plugins
   * - `enforce: 'post'` plugins
   * - vite build post plugins
   */
  enforce?: 'pre' | 'post'
  /**
   * Perform custom handling of HMR updates.
   * The handler receives a context containing changed filename, timestamp, a
   * list of modules affected by the file change, and the dev server instance.
   *
   * - The hook can return a filtered list of modules to narrow down the update.
   *   e.g. for a Vue SFC, we can narrow down the part to update by comparing
   *   the descriptors.
   *
   * - The hook can also return an empty array and then perform custom updates
   *   by sending a custom hmr payload via server.hot.send().
   *
   * - If the hook doesn't return a value, the hmr update will be performed as
   *   normal.
   */
  hotUpdate?: ObjectHook<
    (
      this: void,
      ctx: HotUpdateContext,
    ) =>
      | Array<EnvironmentModuleNode>
      | void
      | Promise<Array<EnvironmentModuleNode> | void>
  >

  /**
   * extend hooks with ssr flag
   */
  resolveId?: ObjectHook<
    (
      this: ResolveIdPluginContext,
      source: string,
      importer: string | undefined,
      options: {
        attributes: Record<string, string>
        custom?: CustomPluginOptions
        /**
         * @deprecated use this.environment
         */
        ssr?: boolean
        /**
         * @internal
         */
        scan?: boolean
        isEntry: boolean
      },
    ) => Promise<ResolveIdResult> | ResolveIdResult
  >
  load?: ObjectHook<
    (
      this: PluginContext,
      id: string,
      options?: {
        /**
         * @deprecated use this.environment
         */
        ssr?: boolean
        /**
         * @internal
         */
        html?: boolean
      },
    ) => Promise<LoadResult> | LoadResult
  >
  transform?: ObjectHook<
    (
      this: TransformPluginContext,
      code: string,
      id: string,
      options?: {
        /**
         * @deprecated use this.environment
         */
        ssr?: boolean
      },
    ) => Promise<TransformResult> | TransformResult
  >

  // TODO: abstract to every hook in RollupPlugin?
  buildStart?: ModifyHookContext<RollupPlugin<A>['buildStart'], PluginContext>
  generateBundle?: ModifyHookContext<
    RollupPlugin<A>['generateBundle'],
    PluginContext
  >
  renderChunk?: ModifyHookContext<RollupPlugin<A>['renderChunk'], PluginContext>
}

export type IsolatedPlugin<A = any> = BasePlugin<A>

export interface Plugin<A = any> extends BasePlugin<A> {
  /**
   * Opt-in this plugin into the shared plugins pipeline.
   * For backward-compatibility, plugins are re-recreated for each environment
   * during `vite build --app`
   * We have an opt-in per plugin, and a general `builder.sharedPlugins`
   * In a future major, we'll flip the default to be shared by default
   * @experimental
   */
  sharedDuringBuild?: boolean
  /**
   * Apply the plugin only for serve or build, or on certain conditions.
   */
  apply?:
    | 'serve'
    | 'build'
    | ((this: void, config: UserConfig, env: ConfigEnv) => boolean)
  /**
   * Modify vite config before it's resolved. The hook can either mutate the
   * passed-in config directly, or return a partial config object that will be
   * deeply merged into existing config.
   *
   * Note: User plugins are resolved before running this hook so injecting other
   * plugins inside  the `config` hook will have no effect.
   */
  config?: ObjectHook<
    (
      this: void,
      config: UserConfig,
      env: ConfigEnv,
    ) =>
      | Omit<UserConfig, 'plugins'>
      | null
      | void
      | Promise<Omit<UserConfig, 'plugins'> | null | void>
  >
  /**
   * Modify environment configs before it's resolved. The hook can either mutate the
   * passed-in environment config directly, or return a partial config object that will be
   * deeply merged into existing config.
   * This hook is called for each environment with a partially resolved environment config
   * that already accounts for the default environment config values set at the root level.
   * If plugins need to modify the config of a given environment, they should do it in this
   * hook instead of the config hook. Leaving the config hook only for modifying the root
   * default environment config.
   */
  configEnvironment?: ObjectHook<
    (
      this: void,
      name: string,
      config: EnvironmentOptions,
      env: ConfigEnv,
    ) =>
      | EnvironmentOptions
      | null
      | void
      | Promise<EnvironmentOptions | null | void>
  >
  /**
   * Use this hook to read and store the final resolved vite config.
   */
  configResolved?: ObjectHook<
    (this: void, config: ResolvedConfig) => void | Promise<void>
  >
  /**
   * Configure the vite server. The hook receives the {@link ViteDevServer}
   * instance. This can also be used to store a reference to the server
   * for use in other hooks.
   *
   * The hooks will be called before internal middlewares are applied. A hook
   * can return a post hook that will be called after internal middlewares
   * are applied. Hook can be async functions and will be called in series.
   */
  configureServer?: ObjectHook<ServerHook>
  /**
   * Configure the preview server. The hook receives the {@link PreviewServer}
   * instance. This can also be used to store a reference to the server
   * for use in other hooks.
   *
   * The hooks are called before other middlewares are applied. A hook can
   * return a post hook that will be called after other middlewares are
   * applied. Hooks can be async functions and will be called in series.
   */
  configurePreviewServer?: ObjectHook<PreviewServerHook>
  /**
   * Transform index.html.
   * The hook receives the following arguments:
   *
   * - html: string
   * - ctx?: vite.ServerContext (only present during serve)
   * - bundle?: rollup.OutputBundle (only present during build)
   *
   * It can either return a transformed string, or a list of html tag
   * descriptors that will be injected into the `<head>` or `<body>`.
   *
   * By default the transform is applied **after** vite's internal html
   * transform. If you need to apply the transform before vite, use an object:
   * `{ order: 'pre', handler: hook }`
   */
  transformIndexHtml?: IndexHtmlTransform

  /**
   * @deprecated
   * Compat support, ctx.modules is a backward compatible ModuleNode array
   * with the mixed client and ssr moduleGraph. Use hotUpdate instead
   */
  handleHotUpdate?: ObjectHook<
    (
      this: void,
      ctx: HmrContext,
    ) => Array<ModuleNode> | void | Promise<Array<ModuleNode> | void>
  >
}

export type HookHandler<T> = T extends ObjectHook<infer H> ? H : T

export type PluginWithRequiredHook<K extends keyof Plugin> = Plugin & {
  [P in K]: NonNullable<Plugin[P]>
}

export type IsolatedPluginConstructor = {
  (environment: PluginEnvironment): IsolatedPluginOption
  sharedDuringBuild?: boolean
}

export type MaybeIsolatedPlugin = IsolatedPlugin | false | null | undefined

export type IsolatedPluginOption =
  | MaybeIsolatedPlugin
  | IsolatedPluginOption[]
  | Promise<MaybeIsolatedPlugin | IsolatedPluginOption[]>

export type MaybePlugin =
  | Plugin
  | IsolatedPluginConstructor
  | false
  | null
  | undefined

export type PluginOption =
  | MaybePlugin
  | PluginOption[]
  | Promise<MaybePlugin | PluginOption[]>

export async function resolveIsolatedPlugins(
  environment: PluginEnvironment,
): Promise<IsolatedPlugin[]> {
  const resolvedPlugins: IsolatedPlugin[] = []
  for (const plugin of environment.config.plugins) {
    if (typeof plugin === 'function') {
      const isolatedPlugin = await plugin(environment)
      if (isolatedPlugin) {
        const flatPlugins = await asyncFlattenIsolatedPlugin(
          environment,
          isolatedPlugin,
        )
        resolvedPlugins.push(...flatPlugins)
      }
    } else {
      resolvedPlugins.push(plugin)
    }
  }
  return resolvedPlugins
}

async function asyncFlattenIsolatedPlugin(
  environment: PluginEnvironment,
  plugins: IsolatedPluginOption,
): Promise<IsolatedPlugin[]> {
  if (!Array.isArray(plugins)) {
    plugins = [plugins]
  }
  do {
    plugins = (
      await Promise.all(
        plugins.map((p: any) => (typeof p === 'function' ? p(environment) : p)),
      )
    )
      .flat(Infinity)
      .filter(Boolean) as IsolatedPluginOption[]
  } while (plugins.some((v: any) => v?.then || v?.split))
  return plugins as IsolatedPlugin[]
}
