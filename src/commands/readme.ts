// tslint:disable no-implicit-dependencies
import { Command, flags } from '@oclif/command'
import * as Config from '@oclif/config'
import { getHelpClass } from '@oclif/plugin-help'
import * as fs from 'fs-extra'
import * as _ from 'lodash'
import * as path from 'path'
import { URL } from 'url'

import { castArray, compact, sortBy, template, uniqBy } from '../util'
import { HelpCompatibilityWrapper } from '../help-compatibility'

const normalize = require('normalize-package-data')
const columns = parseInt(process.env.COLUMNS!, 10) || 120
const slugify = new (require('github-slugger') as any)()


const formatDescription = (d: string | undefined): string => {
  return d ? `${d.charAt(0).toUpperCase()}${d.substring(1)}.` : ''
}

export default class Readme extends Command {
  static description = `adds commands to README.md in current directory
The readme must have any of the following tags inside of it for it to be replaced or else it will do nothing:
## Usage
<!-- usage -->
## Commands
<!-- commands -->

Customize the code URL prefix by setting oclif.repositoryPrefix in package.json.
`

  static flags = {
    dir: flags.string({ description: 'output directory for multi docs', default: 'docs', required: true }),
    multi: flags.boolean({ description: 'create a different markdown page for each topic' }),
    plugin: flags.boolean({ description: 'create a plugin readme doc' }),
    bin: flags.string({ description: 'optional main cli command', dependsOn: ['plugin'] })
  }

  async run() {
    const { flags } = this.parse(Readme)
    const cwd = process.cwd()
    const readmePath = path.resolve(cwd, 'README.md')
    const config = await Config.load({ root: cwd, devPlugins: false, userPlugins: false })

    if (flags.bin) config.bin = flags.bin

    try {
      const p = require.resolve('@oclif/plugin-legacy', { paths: [cwd] })
      const plugin = new Config.Plugin({ root: p, type: 'core' })
      await plugin.load()
      config.plugins.push(plugin)
    } catch { }
    await (config as Config.Config).runHook('init', { id: 'readme', argv: this.argv })
    let readme = await fs.readFile(readmePath, 'utf8')

    let commands = config.commands
    commands = commands.filter(c => !c.hidden)
    commands = commands.filter(c => c.pluginType === 'core')
    this.debug('commands:', commands.map(c => c.id).length)
    commands = uniqBy(commands, c => c.id)
    commands = sortBy(commands, c => c.id)
    readme = this.replaceTag(readme, 'usage', flags.plugin ? '' : this.usage(config))
    readme = this.replaceTag(readme, 'commands', flags.multi ? this.multiCommands(config, commands, flags.dir) : this.commands(config, commands))
    readme = this.replaceTag(readme, 'toc', this.toc(config, readme))

    readme = readme.trimRight()
    readme += '\n'

    await fs.outputFile(readmePath, readme)
  }

  replaceTag(readme: string, tag: string, body: string): string {
    if (readme.includes(`<!-- ${tag} -->`)) {
      if (readme.includes(`<!-- ${tag}stop -->`)) {
        readme = readme.replace(new RegExp(`<!-- ${tag} -->(.|\n)*<!-- ${tag}stop -->`, 'm'), `<!-- ${tag} -->`)
      }
      this.log(`replacing <!-- ${tag} --> in README.md`)
    }
    // return readme.replace(`<!-- ${tag} -->`, `<!-- ${tag} -->\n${body}\n<!-- ${tag}stop -->`)
    return readme.replace(`<!-- ${tag} -->`, `<!-- ${tag} -->\n\n${body}\n<!-- ${tag}stop -->`)
  }

  toc(__: Config.IConfig, readme: string): string {
    // return readme.split('\n').filter(l => l.startsWith('# '))
    return readme.split('\n').filter(l => l.startsWith('## ') && !l.includes('Table of contents') && !l.includes('What is Commerce Layer'))
      .map(l => l.trim().slice(2))
      .map(l => `* [${l}](#${slugify.slug(l)})`)
      .join('\n')
  }

  usage(config: Config.IConfig): string {
    return [
      `\`\`\`sh-session
$ ${config.bin} COMMAND

$ ${config.bin} (-v | version | --version) to check the version of the CLI you have installed.

$ ${config.bin} [COMMAND] (--help | -h) for detailed information about CLI commands.
\`\`\`\n`,
    ].join('\n').trim()
  }

  multiCommands(config: Config.IConfig, commands: Config.Command[], dir: string): string {
    let topics = config.topics
    topics = topics.filter(t => !t.hidden && !t.name.includes(':'))
    topics = topics.filter(t => commands.find(c => c.id.startsWith(t.name)))
    topics = sortBy(topics, t => t.name)
    topics = uniqBy(topics, t => t.name)
    for (const topic of topics) {
      this.createTopicFile(
        path.join('.', dir, topic.name.replace(/:/g, '/') + '.md'),
        config,
        topic,
        commands.filter(c => c.id === topic.name || c.id.startsWith(topic.name + ':')),
      )
    }

    return [
      '\n',
      // '# Command Topics\n',
      ...topics.map(t => {
        return compact([
          `* [\`${config.bin} ${t.name}\`](${dir}/${t.name.replace(/:/g, '/')}.md)`,
          template({ config })(formatDescription(t.description)).trim().split('\n')[0],
        ]).join(' - ')
      }),
    ].join('\n').trim() + '\n'
  }

  createTopicFile(file: string, config: Config.IConfig, topic: Config.Topic, commands: Config.Command[]) {
    const bin = `\`${config.bin} ${topic.name}\``
    const t = topic
    const doc = [
      bin,
      '='.repeat(bin.length),
      '',
      template({ config })(formatDescription(t.description)).trim(),
      '',
      this.commands(config, commands),
    ].join('\n').trim() + '\n'
    fs.outputFileSync(file, doc)
  }

  commands(config: Config.IConfig, commands: Config.Command[]): string {
    return [
      ...commands.map(c => {
        const usage = this.commandUsage(config, c)
        return `* [\`${config.bin} ${usage}\`](#${slugify.slug(`${config.bin}-${usage}`)})`
      }),
      '',
      ...commands.map(c => this.renderCommand(config, c)).map(s => s.trim() + '\n'),
    ].join('\n').trim()
  }

  renderCommand(config: Config.IConfig, c: Config.Command): string {
    this.debug('rendering command', c.id)
    const title = template({ config, command: c })(formatDescription(c.description)).trim().split('\n')[0]
    const HelpClass = getHelpClass(config)
    const help = new HelpClass(config, { stripAnsi: true, maxWidth: columns })
    const wrapper = new HelpCompatibilityWrapper(help)

    // const header = () => `## \`${config.bin} ${this.commandUsage(config, c)}\``
    const header = () => `### \`${config.bin} ${this.commandUsage(config, c)}\``

    try {
      return compact([
        header(),
        title,
        '```\n' + wrapper.formatCommand(c).trim() + '\n```',
        this.commandCode(config, c),
      ]).join('\n\n')
    } catch (error: any) {
      this.error(error.message)
    }
  }

  commandCode(config: Config.IConfig, c: Config.Command): string | undefined {
    const pluginName = c.pluginName
    if (!pluginName) return
    const plugin = config.plugins.find(p => p.name === c.pluginName)
    if (!plugin) return
    const repo = this.repo(plugin)
    if (!repo) return
    let label = plugin.name
    let version = plugin.version
    const commandPath = this.commandPath(plugin, c)
    if (!commandPath) return
    if (config.name === plugin.name) {
      label = commandPath
      version = process.env.OCLIF_NEXT_VERSION || version
    }
    const template = plugin.pjson.oclif.repositoryPrefix || '<%- repo %>/blob/v<%- version %>/<%- commandPath %>'
    return `_See code: [${label}](${_.template(template)({ repo, version, commandPath, config, c })})_`
  }

  private repo(plugin: Config.IPlugin): string | undefined {
    const pjson = { ...plugin.pjson }
    normalize(pjson)
    const repo = pjson.repository && pjson.repository.url
    if (!repo) return
    const url = new URL(repo)
    if (!['github.com', 'gitlab.com'].includes(url.hostname) && !pjson.oclif.repositoryPrefix) return
    return `https://${url.hostname}${url.pathname.replace(/\.git$/, '')}`
  }

  // eslint-disable-next-line valid-jsdoc
  /**
   * fetches the path to a command
   */
  private commandPath(plugin: Config.IPlugin, c: Config.Command): string | undefined {
    const commandsDir = plugin.pjson.oclif.commands
    if (!commandsDir) return
    let p = path.join(plugin.root, commandsDir, ...c.id.split(':'))
    const libRegex = new RegExp('^lib' + (path.sep === '\\' ? '\\\\' : path.sep))
    if (fs.pathExistsSync(path.join(p, 'index.js'))) {
      p = path.join(p, 'index.js')
    } else if (fs.pathExistsSync(p + '.js')) {
      p += '.js'
    } else if (plugin.pjson.devDependencies && plugin.pjson.devDependencies.typescript) {
      // check if non-compiled scripts are available
      const base = p.replace(plugin.root + path.sep, '')
      p = path.join(plugin.root, base.replace(libRegex, 'src' + path.sep))
      if (fs.pathExistsSync(path.join(p, 'index.ts'))) {
        p = path.join(p, 'index.ts')
      } else if (fs.pathExistsSync(p + '.ts')) {
        p += '.ts'
      } else return
    } else return
    p = p.replace(plugin.root + path.sep, '')
    if (plugin.pjson.devDependencies && plugin.pjson.devDependencies.typescript) {
      p = p.replace(libRegex, 'src' + path.sep)
      p = p.replace(/\.js$/, '.ts')
    }
    p = p.replace(/\\/g, '/') // Replace windows '\' by '/'
    return p
  }

  private commandUsage(config: Config.IConfig, command: Config.Command): string {
    const arg = (arg: Config.Command.Arg) => {
      const name = arg.name.toUpperCase()
      if (arg.required) return `${name}`
      return `[${name}]`
    }
    const defaultUsage = () => {
      // const flags = Object.entries(command.flags)
      // .filter(([, v]) => !v.hidden)
      return compact([
        command.id,
        command.args.filter(a => !a.hidden).map(a => arg(a)).join(' '),
      ]).join(' ')
    }
    const usages = castArray(command.usage)
    return template({ config, command })(usages.length === 0 ? defaultUsage() : usages[0])
  }
}
