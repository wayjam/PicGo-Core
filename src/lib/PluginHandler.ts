import PicGo from '../core/PicGo'
import spawn from 'cross-spawn'
import { IResult, IProcessEnv, Undefinable, IPluginProcessResult } from '../types'
import { IBuildInEvent } from '../utils/enum'
import { getProcessPluginName, getNormalPluginName } from '../utils/common'

class PluginHandler {
  // Thanks to feflow -> https://github.com/feflow/feflow/blob/master/lib/internal/install/plugin.js
  ctx: PicGo
  constructor (ctx: PicGo) {
    this.ctx = ctx
  }

  async install (plugins: string[], proxy: string = '', env?: IProcessEnv): Promise<void> {
    const installedPlugins: string[] = []
    const processPlugins = plugins
      .map((item: string) => handlePluginNameProcess(this.ctx, item))
      .filter((item) => {
        // detect if has already installed
        // or will cause error
        if (this.ctx.pluginLoader.hasPlugin(item.pkgName)) {
          installedPlugins.push(item.pkgName)
          this.ctx.log.success(`PicGo has already installed ${item.pkgName}`)
          return false
        }
        // if something wrong, filter it out
        if (!item.success) {
          return false
        }
        return true
      })
    const fullNameList = processPlugins.map(item => item.fullName)
    const pkgNameList = processPlugins.map(item => item.pkgName)
    if (fullNameList.length > 0) {
      // install plugins must use fullNameList:
      // 1. install remote pacage
      // 2. install local pacage
      const result = await this.execCommand('install', fullNameList, this.ctx.baseDir, proxy, env)
      if (!result.code) {
        pkgNameList.forEach((pluginName: string) => {
          this.ctx.pluginLoader.registerPlugin(pluginName)
        })
        this.ctx.log.success('插件安装成功')
        this.ctx.emit('installSuccess', {
          title: '插件安装成功',
          body: [...pkgNameList, ...installedPlugins]
        })
      } else {
        const err = `插件安装失败，失败码为${result.code}，错误日志为${result.data}`
        this.ctx.log.error(err)
        this.ctx.emit('installFailed', {
          title: '插件安装失败',
          body: err
        })
      }
    } else if (installedPlugins.length === 0) {
      const err = '插件安装失败，请输入合法插件名或合法安装路径'
      this.ctx.log.error(err)
      this.ctx.emit('installFailed', {
        title: '插件安装失败',
        body: err
      })
    } else {
      this.ctx.log.success('插件安装成功')
      this.ctx.emit('installSuccess', {
        title: '插件安装成功',
        body: [...pkgNameList, ...installedPlugins]
      })
    }
  }

  async uninstall (plugins: string[]): Promise<void> {
    const processPlugins = plugins.map((item: string) => handlePluginNameProcess(this.ctx, item)).filter(item => item.success)
    const pkgNameList = processPlugins.map(item => item.pkgName)
    if (pkgNameList.length > 0) {
      // uninstall plugins must use pkgNameList:
      // npm uninstall will use the package.json's name
      const result = await this.execCommand('uninstall', pkgNameList, this.ctx.baseDir)
      if (!result.code) {
        pkgNameList.forEach((pluginName: string) => {
          this.ctx.pluginLoader.unregisterPlugin(pluginName)
        })
        this.ctx.log.success('插件卸载成功')
        this.ctx.emit('uninstallSuccess', {
          title: '插件卸载成功',
          body: pkgNameList
        })
      } else {
        const err = `插件卸载失败，失败码为${result.code}，错误日志为${result.data}`
        this.ctx.log.error(err)
        this.ctx.emit('uninstallFailed', {
          title: '插件卸载失败',
          body: err
        })
      }
    } else {
      const err = '插件卸载失败，请输入合法插件名'
      this.ctx.log.error(err)
      this.ctx.emit('uninstallFailed', {
        title: '插件卸载失败',
        body: err
      })
    }
  }

  async update (plugins: string[], proxy: string = '', env?: IProcessEnv): Promise<void> {
    const processPlugins = plugins.map((item: string) => handlePluginNameProcess(this.ctx, item)).filter(item => item.success)
    const pkgNameList = processPlugins.map(item => item.pkgName)
    if (pkgNameList.length > 0) {
      // update plugins must use pkgNameList:
      // npm update will use the package.json's name
      const result = await this.execCommand('update', pkgNameList, this.ctx.baseDir, proxy, env)
      if (!result.code) {
        this.ctx.log.success('插件更新成功')
        this.ctx.emit('updateSuccess', {
          title: '插件更新成功',
          body: pkgNameList
        })
      } else {
        const err = `插件更新失败，失败码为${result.code}，错误日志为 \n ${result.data}`
        this.ctx.log.error(err)
        this.ctx.emit('updateFailed', {
          title: '插件更新失败',
          body: err
        })
      }
    } else {
      const err = '插件更新失败，请输入合法插件名'
      this.ctx.log.error(err)
      this.ctx.emit('updateFailed', {
        title: '插件更新失败',
        body: err
      })
    }
  }

  async execCommand (cmd: string, modules: string[], where: string, proxy: string = '', env: IProcessEnv = {}): Promise<IResult> {
    const registry = this.ctx.getConfig<Undefinable<string>>('registry')
    return await new Promise((resolve: any): void => {
      let args = [cmd].concat(modules).concat('--color=always').concat('--save')
      if (registry) {
        args = args.concat(`--registry=${registry}`)
      }
      if (proxy) {
        args = args.concat(`--proxy=${proxy}`)
      }
      try {
        const npm = spawn('npm', args, { cwd: where, env: Object.assign({}, process.env, env) })

        let output = ''
        npm.stdout.on('data', (data: string) => {
          output += data
        }).pipe(process.stdout)

        npm.stderr.on('data', (data: string) => {
          output += data
        }).pipe(process.stderr)

        npm.on('close', (code: number) => {
          if (!code) {
            resolve({ code: 0, data: output })
          } else {
            resolve({ code: code, data: output })
          }
        })
        // for users who haven't installed node.js
        npm.on('error', (err: Error) => {
          this.ctx.log.error(err)
          this.ctx.log.error('NPM is not installed')
          this.ctx.emit(IBuildInEvent.FAILED, 'NPM is not installed')
        })
      } catch (e) {
        this.ctx.log.error(e)
        this.ctx.emit(IBuildInEvent.FAILED, e)
      }
    })
  }
}

/**
 * transform the input plugin name or path string to valid result
 * @param ctx
 * @param nameOrPath
 */
const handlePluginNameProcess = (ctx: PicGo, nameOrPath: string): IPluginProcessResult => {
  const res = {
    success: false,
    fullName: '',
    pkgName: ''
  }
  const result = getProcessPluginName(nameOrPath, ctx.log)
  if (!result) {
    return res
  }
  // first get result then do this process
  // or some error will log twice
  const pkgName = getNormalPluginName(result, ctx.log)
  if (!pkgName) {
    return res
  }
  return {
    success: true,
    fullName: result,
    pkgName
  }
}

export default PluginHandler
