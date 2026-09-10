import { sanitizeUrl, truncate, LIMITS } from '@repro/contracts/runtime';
import type { SessionMeta } from '@repro/contracts';

export interface ParsedUserAgent {
  name: string;
  version: string;
  os: string;
}

/**
 * Small, dependency-free user agent parser. It covers the browsers we care about for
 * filtering sessions in the dashboard and reports 'Unknown' for everything else.
 * Order matters: Edge and Opera embed "Chrome", and Chrome embeds "Safari".
 */
export function parseUserAgent(ua: string): ParsedUserAgent {
  const pick = (re: RegExp): string | null => {
    const m = re.exec(ua);
    return m?.[1] ?? null;
  };
  let name = 'Unknown';
  let version = '';
  const edge = pick(/\bEdg(?:e|A|iOS)?\/(\d+(?:\.\d+)*)/);
  const firefox = pick(/\b(?:Firefox|FxiOS)\/(\d+(?:\.\d+)*)/);
  const chrome = pick(/(?:\bChrome|HeadlessChrome|\bCriOS)\/(\d+(?:\.\d+)*)/);
  const safari = /\bSafari\//.test(ua) ? pick(/\bVersion\/(\d+(?:\.\d+)*)/) : null;
  if (edge) {
    name = 'Edge';
    version = edge;
  } else if (firefox) {
    name = 'Firefox';
    version = firefox;
  } else if (chrome) {
    name = 'Chrome';
    version = chrome;
  } else if (safari) {
    name = 'Safari';
    version = safari;
  }

  let os = 'Unknown';
  if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  return { name, version, os };
}

export interface MetaInput {
  sdkVersion: string;
  startedAt: number;
  release?: string;
  environment?: string;
}

/** Snapshot of the browser and page at the start of a page load. Urls are sanitised first. */
export function buildMeta(input: MetaInput): SessionMeta {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent ?? '' : '';
  const parsed = parseUserAgent(ua);
  const meta: SessionMeta = {
    startedAt: input.startedAt,
    sdkVersion: truncate(input.sdkVersion, 32),
    browser: {
      name: parsed.name,
      version: truncate(parsed.version, 50),
      userAgent: truncate(ua, 500),
    },
    os: parsed.os,
    viewport: {
      width: Math.max(0, Math.round(window.innerWidth || 0)),
      height: Math.max(0, Math.round(window.innerHeight || 0)),
    },
    page: {
      url: truncate(sanitizeUrl(location.href), LIMITS.maxUrlLength),
    },
  };
  if (input.release) meta.release = truncate(input.release, 100);
  if (input.environment) meta.environment = truncate(input.environment, 50);
  if (window.devicePixelRatio > 0) meta.viewport.devicePixelRatio = window.devicePixelRatio;
  if (document.title) meta.page.title = truncate(document.title, 200);
  if (document.referrer) meta.page.referrer = truncate(sanitizeUrl(document.referrer), LIMITS.maxUrlLength);
  const locale = navigator.language;
  if (locale) meta.locale = truncate(locale, 20);
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) meta.timezone = truncate(tz, 64);
  } catch {
    // Intl can be missing or throw in exotic embeds; timezone is optional.
  }
  return meta;
}
