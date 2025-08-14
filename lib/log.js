// lib/log.js
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import cliProgress from 'cli-progress';
import prettyMs from 'pretty-ms';

const { SingleBar, Presets } = cliProgress;

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, verbose: 4, debug: 5 };
const ICONS = {
  success: chalk.green('✔'),
  warn: chalk.yellow('⚠'),
  error: chalk.red('✖'),
  info: chalk.cyan('ℹ'),
};

function nowTs() {
  const d = new Date();
  return chalk.gray(d.toTimeString().slice(0, 8));
}

export function createLogger({ level = 'info', name = 'scraper' } = {}) {
  const lvl = LEVELS[level] ?? LEVELS.info;
  const start = Date.now();
  const isTTY = process.stdout.isTTY;

  function can(n) {
    return lvl >= LEVELS[n];
  }
  function line(prefix, msg) {
    process.stdout.write(`${nowTs()} ${prefix ? prefix + ' ' : ''}${msg}\n`);
  }

  const api = {
    banner(title, subtitle = '') {
      const content = [chalk.bold.white(title), subtitle ? chalk.gray(subtitle) : null, chalk.gray(`Session: ${name} • PID ${process.pid}`)].filter(Boolean).join('\n');
      const box = boxen(content, {
        padding: 1,
        borderStyle: 'round',
        borderColor: 'cyan',
        titleAlignment: 'center',
      });
      process.stdout.write(`\n${box}\n\n`);
    },

    section(title) {
      const text = chalk.bold.cyan(title);
      const bar = chalk.gray('─'.repeat(Math.max(10, Math.min(80, title.length + 10))));
      process.stdout.write(`${text}\n${bar}\n`);
    },

    hr() {
      process.stdout.write(chalk.gray('─'.repeat(80)) + '\n');
    },

    info(msg) {
      if (can('info')) line(ICONS.info, msg);
    },
    success(msg) {
      if (can('info')) line(ICONS.success, chalk.green(msg));
    },
    warn(msg) {
      if (can('warn')) line(ICONS.warn, chalk.yellow(msg));
    },
    error(msg) {
      if (can('error')) line(ICONS.error, chalk.red(msg));
    },
    verbose(msg) {
      if (can('verbose')) line(chalk.magenta('…'), chalk.magenta(msg));
    },
    debug(msg) {
      if (can('debug')) line(chalk.gray('·'), chalk.gray(msg));
    },

    kv(title, obj) {
      if (!can('info')) return;
      const rows = Object.entries(obj)
        .map(([k, v]) => `${chalk.gray(k.padEnd(14))} ${chalk.white(typeof v === 'string' ? v : JSON.stringify(v))}`)
        .join('\n');
      process.stdout.write(`${chalk.bold.white(title)}\n${rows}\n`);
    },

    spinner(text) {
      if (!can('info')) return { start() {}, succeed() {}, fail() {}, warn() {}, stop() {} };
      return ora({ text, color: 'cyan' });
    },

    progress(total, { label = 'Progress' } = {}) {
      const fmt =
        `${chalk.cyan(label)} ${chalk.gray('|')} {bar} {value}/{total} ` +
        `${chalk.gray('|')} {percentage}% ${chalk.gray('| ETA:')} {eta_formatted} ` +
        `${chalk.gray('|')} page:{pageCoords} geo:{geocoded} skip:{skipped} err:{errors}`;

      if (!can('info') || !isTTY) {
        let value = 0;
        let payload = { pageCoords: 0, geocoded: 0, skipped: 0, errors: 0 };
        return {
          increment(step = 1, p = {}) {
            value += step;
            Object.assign(payload, p);
            line(
              ICONS.info,
              `${label}: ${value}/${total} (${Math.floor((value / total) * 100)}%) ` +
                `page:${payload.pageCoords} geo:${payload.geocoded} skip:${payload.skipped} err:${payload.errors}`
            );
          },
          update(v, p = {}) {
            value = v;
            Object.assign(payload, p);
            line(
              ICONS.info,
              `${label}: ${value}/${total} (${Math.floor((value / total) * 100)}%) ` +
                `page:${payload.pageCoords} geo:${payload.geocoded} skip:${payload.skipped} err:${payload.errors}`
            );
          },
          stop() {},
        };
      }

      const bar = new SingleBar(
        {
          format: fmt,
          barCompleteChar: '█',
          barIncompleteChar: '░',
          hideCursor: true,
          clearOnComplete: false,
          stopOnComplete: false,
        },
        Presets.shades_classic
      );

      bar.start(total, 0, { pageCoords: 0, geocoded: 0, skipped: 0, errors: 0 });

      return {
        increment(step = 1, payload = {}) {
          bar.increment(step, payload);
        },
        update(v, payload = {}) {
          bar.update(v, payload);
        },
        stop() {
          bar.stop();
        },
      };
    },

    done() {
      const dur = prettyMs(Date.now() - start);
      line(ICONS.success, `All done in ${dur}`);
    },
  };

  return api;
}
