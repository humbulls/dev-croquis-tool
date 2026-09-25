import { mkdirSync } from 'node:fs';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';

/**
 * The whole product loop in a real browser:
 * owner setup → project → sitemap → review link → a client comments on the
 * live site through the widget → the team triages → the client approves.
 * With UPDATE_SCREENSHOTS=1 it also refreshes the images used in the docs.
 */

const API = 'http://localhost:8788';
const SITE = 'http://localhost:4321';
const SHOTS = 'docs/images/v1';
const updateShots = Boolean(process.env.UPDATE_SCREENSHOTS);
if (updateShots) mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  if (updateShots) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test.describe.configure({ mode: 'serial' });

let owner: BrowserContext;
let reviewer: BrowserContext;
let ownerPage: Page;
let projectId = '';
let ingestKey = '';
let slug = '';

test.beforeAll(async ({ browser }) => {
  owner = await browser.newContext({ baseURL: API, locale: 'en-US', colorScheme: 'light' });
  reviewer = await browser.newContext({ baseURL: API, locale: 'en-US', colorScheme: 'light' });
  ownerPage = await owner.newPage();
});

test.afterAll(async () => {
  await owner.close();
  await reviewer.close();
});

test('the operator creates the owner account on a fresh instance', async () => {
  const page = ownerPage;
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel('Admin token').fill(process.env.E2E_ADMIN_TOKEN as string);
  await page.getByLabel('Name', { exact: true }).fill('Olivia Chen');
  await page.getByLabel('Email', { exact: true }).fill('olivia@northwind.example');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await page.getByLabel('Workspace name').fill('Northwind Studio');
  await page.getByRole('button', { name: 'Create owner account' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText('No projects yet')).toBeVisible();
});

test('creates a project for the client site', async () => {
  const page = ownerPage;
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name').fill('Northwind marketing site');
  await page.getByLabel('Site URL').fill(SITE);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}\/settings/);
  projectId = /projects\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  const snippet = page.locator('.c-code').first();
  await expect(snippet).toContainText('data-croquis-key="ing_');
  ingestKey = /data-croquis-key="(ing_[^"]+)"/.exec((await snippet.textContent()) ?? '')?.[1] ?? '';
  expect(ingestKey).toMatch(/^ing_/);
  await expect(page.getByText(SITE).first()).toBeVisible();
});

test('plans the sitemap and drafts content', async () => {
  const page = ownerPage;
  await page.goto(`/projects/${projectId}/pages`);
  for (const [path, title] of [
    ['/', 'Home'],
    ['/pricing', 'Pricing'],
  ]) {
    await page
      .getByRole('button', { name: /Add (child )?page/ })
      .first()
      .click();
    await page.getByLabel('Path').fill(path as string);
    await page.getByLabel('Title').fill(title as string);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('treeitem', { name: new RegExp(title as string) })).toBeVisible();
    await page.goto(`/projects/${projectId}/pages`);
  }
  await page.getByRole('treeitem', { name: /Home/ }).click();
  await page.getByRole('button', { name: 'Add block' }).click();
  await page.getByRole('menuitem', { name: 'Heading' }).click();
  const block = page.getByLabel('Heading').last();
  await block.fill('Websites your clients approve on the first round.');
  await block.blur();
  await expect(page.getByText('Pricing').first()).toBeVisible();
});

test('shares a review link', async () => {
  const page = ownerPage;
  await page.goto(`/projects/${projectId}/share`);
  await page.getByRole('button', { name: 'New review link' }).first().click();
  await page.getByLabel('Label').fill('Client review — round 1');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('Client review — round 1')).toBeVisible();
  const links = await (await page.request.get(`/api/v1/projects/${projectId}/share-links`)).json();
  slug = links.data[0].slug;
  expect(slug).toMatch(/^[a-z0-9]{12}$/);
  await shot(page, 'share');
});

test('a client leaves pinned feedback on the live site', async () => {
  const page = await reviewer.newPage();
  await page.goto(`${SITE}/?croquis=${slug}#key=${ingestKey}&api=${API}`);
  const gate = page.locator('.cq-gate');
  await expect(gate).toBeVisible();
  await gate.getByRole('textbox').first().fill('Aiko Tanaka');
  await gate.getByRole('button', { name: 'Start reviewing' }).click();
  await expect(gate).toBeHidden();

  await page.locator('.cq-pill__action--primary').click();
  await page.getByRole('heading', { level: 1 }).click();
  const composer = page.locator('.cq-composer');
  await expect(composer).toBeVisible();
  await composer
    .locator('textarea')
    .first()
    .fill('Can we make the headline shorter? It wraps to three lines on my laptop.');
  await composer.getByRole('button', { name: 'Suggest new text' }).click();
  await composer
    .locator('.cq-suggestion textarea')
    .nth(1)
    .fill('Websites clients approve first time.');
  await shot(page, 'widget-composer');
  await composer.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.cq-toast')).toContainText('Thanks');
  await expect(page.locator('.cq-pin')).toHaveCount(1);

  await page.goto(`${SITE}/pricing.html`);
  await page.locator('.cq-pill__action--primary').click();
  await page.locator('.card--featured .price').click();
  await page.locator('.cq-composer textarea').first().fill('Please show this price including tax.');
  await page.locator('.cq-composer').getByRole('radio', { name: 'Bug' }).click();
  await page.locator('.cq-composer').getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.cq-toast')).toContainText('Thanks');
  await shot(page, 'widget-pins');
  await page.close();
});

test('the team triages feedback in the inbox', async () => {
  const page = ownerPage;
  await page.goto(`/projects/${projectId}/inbox`);
  const row = page.locator('.c-comment-row', { hasText: 'headline shorter' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Aiko Tanaka');
  await row.click();
  const inspector = page.getByRole('complementary');
  await expect(inspector).toContainText('Websites clients approve first time.');
  await expect(inspector.locator('.c-screenshot')).toBeVisible();
  await inspector.getByRole('button', { name: /Priority:/ }).click();
  await page.getByRole('menuitemradio', { name: 'High' }).click();
  await inspector.getByRole('button', { name: /Status: Open/ }).click();
  await page.getByRole('menuitemradio', { name: 'In progress' }).click();
  await inspector.getByLabel('Reply').fill('Good call — shortening it in the next deploy.');
  await inspector.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(inspector.getByText('Good call — shortening it')).toBeVisible();
  await shot(page, 'inbox');
});

test('moves a card on the board', async () => {
  const page = ownerPage;
  await page.goto(`/projects/${projectId}/board`);
  const card = page.locator('.c-board-card', { hasText: 'including tax' });
  await card.dragTo(page.getByRole('region', { name: 'In review' }));
  await expect(
    page
      .getByRole('region', { name: 'In review' })
      .locator('.c-board-card', { hasText: 'including tax' }),
  ).toBeVisible();
  await shot(page, 'board');
});

test('the client approves a page in the share viewer', async () => {
  const page = await reviewer.newPage();
  await page.goto(`/s/${slug}`);
  await page.getByLabel('Your name').fill('Aiko Tanaka');
  await page.getByRole('button', { name: 'Start reviewing' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Websites your clients approve on the first round.' }),
  ).toBeVisible();
  await expect(page.getByText('headline shorter')).toBeVisible();
  await page.getByRole('button', { name: 'Approve page' }).click();
  await expect(page.getByText('You approved this page')).toBeVisible();
  await shot(page, 'share-viewer');
  await page.close();

  await ownerPage.goto(`/projects/${projectId}/pages`);
  await expect(ownerPage.getByRole('treeitem', { name: /Home/ })).toContainText('Approved');
  await ownerPage.getByRole('treeitem', { name: /Home/ }).click();
  await expect(ownerPage.getByLabel('Heading')).toHaveValue(
    'Websites your clients approve on the first round.',
  );
  await shot(ownerPage, 'sitemap');
});

test('dark mode and Japanese UI', async ({ browser }) => {
  test.skip(!updateShots, 'screenshots only');
  const context = await browser.newContext({
    baseURL: API,
    locale: 'ja-JP',
    colorScheme: 'dark',
    storageState: await owner.storageState(),
  });
  const page = await context.newPage();
  await page.goto(`/projects/${projectId}/inbox`);
  await page.locator('.c-comment-row', { hasText: 'headline shorter' }).click();
  await expect(page.getByRole('complementary').locator('.c-inspector__title')).toBeVisible();
  await expect(page.getByRole('complementary').locator('.c-screenshot')).toBeVisible();
  await shot(page, 'inbox-dark-ja');
  await page.goto('/projects');
  await expect(page.locator('.c-card').first()).toBeVisible();
  await shot(page, 'projects-dark-ja');
  await context.close();
});
