const linkedin = require('./linkedin');
const presentation = require('./presentation');
const studioContent = require('./studioContent.json');

const sectionFor = (item, fallback) => presentation[item.slug]?.section || fallback;
const dateFor = (item) => presentation[item.slug]?.date || '';
const newestFirst = (a, b) => dateFor(b).localeCompare(dateFor(a));
const storedOrder = (items, section) => {
  const preferred = studioContent.order?.[section] || [];
  const rank = new Map(preferred.map((slug, index) => [slug, index]));
  return [...items].sort((a, b) => {
    const aRank = rank.has(a.slug) ? rank.get(a.slug) : Number.MAX_SAFE_INTEGER;
    const bRank = rank.has(b.slug) ? rank.get(b.slug) : Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
};

const decorate = (item, section, kind) => ({
  ...item,
  ...(studioContent.posts?.[item.slug]?.source || {}),
  studio: studioContent.posts?.[item.slug] || null,
  section,
  kind,
  displayTitle: presentation[item.slug]?.displayTitle || '',
  fullPageUrl: `/${section}/${item.slug}/`,
  sectionUrl: section === 'articles' ? '/' : `/${section}/`
});

const articles = storedOrder([
  ...linkedin.articles.filter((item) => sectionFor(item, 'article') === 'article'),
  ...linkedin.projects.filter((item) => sectionFor(item, 'project') === 'article')
].sort(newestFirst).map((item) => decorate(item, 'articles', 'Article')), 'articles');

const linkedProjects = linkedin.projects
  .filter((item) => sectionFor(item, 'project') === 'project')
  .sort(newestFirst)
  .map((item) => decorate(item, 'projects', 'Project'));

const specialProjects = [{
  slug: 'bc2',
  title: '',
  paragraphs: ['Coming soon'],
  source: '',
  section: 'projects',
  kind: 'Project',
  displayTitle: studioContent.pages?.bc2?.title || 'BC2',
  fullPageUrl: '/bc2/',
  sectionUrl: '/projects/',
  placeholder: true,
  studio: studioContent.pages?.bc2 || null
}];

const projects = storedOrder([...linkedProjects, ...specialProjects], 'projects');

const openSource = storedOrder(linkedin.projects
  .filter((item) => sectionFor(item, 'project') === 'open-source')
  .sort(newestFirst)
  .map((item) => decorate(item, 'open-source', 'Open source')), 'open-source');

module.exports = {
  articles,
  projects,
  openSource,
  all: [...articles, ...linkedProjects, ...openSource]
};
