// The site documents two lines: AOS 1.0 at the root, and the 0.11 release kept whole under /0.11/ for
// people still running it. Layouts take a version and read their navigation from here, so both lines'
// menus live in one place.
export type Version = '1.0' | '0.11';

export const V011_PREFIX = '/0.11';
export const REPO = 'https://github.com/aos-engineer/harness';

export interface NavLink { title: string; href: string }
export interface NavGroup { title: string; links: NavLink[] }

// The 1.0 docs are rendered from the repository's docs/1.0/*.md; each slug is a file name.
export const DOCS_1_0: NavGroup[] = [
  {
    title: 'Start here',
    links: [
      { title: 'Getting started', href: '/docs/getting-started/' },
      { title: 'Concepts', href: '/docs/concepts/' },
      { title: 'Troubleshooting', href: '/docs/troubleshooting/' },
    ],
  },
  {
    title: 'Reference',
    links: [
      { title: 'CLI', href: '/docs/cli/' },
      { title: 'MCP tools', href: '/docs/mcp-tools/' },
      { title: 'Packs', href: '/docs/packs/' },
      { title: 'Security model', href: '/docs/security/' },
    ],
  },
  {
    title: 'Contributors',
    links: [
      { title: 'Architecture', href: '/docs/architecture/' },
      { title: 'Releasing', href: '/docs/releasing/' },
    ],
  },
];

export const DOCS_0_11: NavGroup[] = [
  {
    title: 'Start here',
    links: [
      { title: 'Getting Started', href: '/0.11/docs/getting-started/' },
      { title: 'Creating Agents', href: '/0.11/docs/creating-agents/' },
      { title: 'Creating Profiles', href: '/0.11/docs/creating-profiles/' },
      { title: 'Creating Domains', href: '/0.11/docs/creating-domains/' },
      { title: 'Creating Workflows', href: '/0.11/docs/creating-workflows/' },
      { title: 'Creating Skills', href: '/0.11/docs/creating-skills/' },
    ],
  },
  {
    title: 'Runtime',
    links: [
      { title: 'Domain Enforcement', href: '/0.11/docs/domain-enforcement/' },
      { title: 'Hierarchical Delegation', href: '/0.11/docs/hierarchical-delegation/' },
      { title: 'Memory System', href: '/0.11/docs/persistent-expertise/' },
      { title: 'Event Summarization', href: '/0.11/docs/event-summarization/' },
      { title: 'Session Resumption', href: '/0.11/docs/session-resumption/' },
      { title: 'Dev Execution', href: '/0.11/docs/dev-execution/' },
    ],
  },
  {
    title: 'Interop & Mesh',
    links: [
      { title: 'Serving over A2A', href: '/0.11/docs/serving-over-a2a/' },
      { title: 'MCP Toolsets', href: '/0.11/docs/mcp-toolsets/' },
      { title: 'Agent Mesh Security', href: '/0.11/docs/agent-mesh-security/' },
    ],
  },
];

export interface TopLink { label: string; href: string; external?: boolean }

export function topLinks(version: Version): TopLink[] {
  return version === '1.0'
    ? [
        { href: '/docs/getting-started/', label: 'Docs' },
        { href: '/docs/cli/', label: 'CLI' },
        { href: `${V011_PREFIX}/`, label: '0.11' },
        { href: REPO, label: 'GitHub', external: true },
      ]
    : [
        { href: `${V011_PREFIX}/docs/getting-started/`, label: 'Docs' },
        { href: `${V011_PREFIX}/agents/`, label: 'Agents' },
        { href: `${V011_PREFIX}/profiles/`, label: 'Profiles' },
        { href: '/', label: '1.0' },
        { href: REPO, label: 'GitHub', external: true },
      ];
}

/** Site sections for the non-docs layout's rail. */
export function siteGroups(version: Version): NavGroup[] {
  if (version === '1.0') {
    return [
      { title: 'AOS 1.0', links: [{ title: 'Overview', href: '/' }, ...DOCS_1_0[0]!.links] },
      { title: 'Reference', links: DOCS_1_0[1]!.links },
      { title: 'Earlier release', links: [{ title: 'AOS 0.11', href: `${V011_PREFIX}/` }] },
    ];
  }
  return [
    {
      title: 'Explore 0.11',
      links: [
        { title: 'Overview', href: `${V011_PREFIX}/` },
        { title: 'Agents', href: `${V011_PREFIX}/agents/` },
        { title: 'Profiles', href: `${V011_PREFIX}/profiles/` },
        { title: 'Skills', href: `${V011_PREFIX}/skills/` },
        { title: 'Domains', href: `${V011_PREFIX}/domains/` },
      ],
    },
    {
      title: 'Documentation',
      links: [
        { title: 'Getting Started', href: `${V011_PREFIX}/docs/getting-started/` },
        { title: 'Dev Execution', href: `${V011_PREFIX}/docs/dev-execution/` },
        { title: 'Domain Enforcement', href: `${V011_PREFIX}/docs/domain-enforcement/` },
      ],
    },
    { title: 'Current release', links: [{ title: 'AOS 1.0', href: '/' }] },
  ];
}

/**
 * The page in the other line that covers the same ground, so the banner can send a reader there rather than
 * to a home page. Only getting started exists in both; everything else falls back to the other home.
 */
export function counterpart(path: string): string {
  if (path === '/docs/getting-started/') return `${V011_PREFIX}/docs/getting-started/`;
  if (path === `${V011_PREFIX}/docs/getting-started/`) return '/docs/getting-started/';
  return path.startsWith(`${V011_PREFIX}/`) ? '/' : `${V011_PREFIX}/`;
}
