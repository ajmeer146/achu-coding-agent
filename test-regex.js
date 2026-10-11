const lowerTask = 'build a simple responsive landing page for an ai product. use the existing project setup where possible. implement the page, run the build, fix any build errors, and explain what you changed.';
const appTargets = 'portfolio|landing page|dashboard|website|web app|full stack|todo app|react app|component library|site|page';
const adjectives = '(modern|responsive|simple|beautiful|clean|minimal|professional)';
const hasAppBuild = new RegExp(`build\\s+(a|an)\\s+(?:${adjectives}\\s+)*(?:${appTargets})`, 'i').test(lowerTask);
const hasAppCreate = new RegExp(`create\\s+(a|an)\\s+(?:${adjectives}\\s+)*(?:${appTargets})`, 'i').test(lowerTask);
const hasAppAdd = new RegExp(`add\\s+(a|an)\\s+(?:landing page|page|component|feature|route|view)`, 'i').test(lowerTask);
const hasAppAddFlexible = /add\s+(an?\s+\w+\s+)?(page|component|feature|route|view)/.test(lowerTask);
const hasAppModify = /modify|update|improve|extend/.test(lowerTask) && /app|website|page|component|dashboard|layout/.test(lowerTask);
const isAppBuildingTask = hasAppBuild || hasAppCreate || hasAppAdd || hasAppAddFlexible || hasAppModify;

console.log('hasAppBuild:', hasAppBuild);
console.log('hasAppCreate:', hasAppCreate);
console.log('hasAppAdd:', hasAppAdd);
console.log('hasAppAddFlexible:', hasAppAddFlexible);
console.log('hasAppModify:', hasAppModify);
console.log('isAppBuildingTask:', isAppBuildingTask);

const hasBugFix = /bug|fix|error|issue|broken/.test(lowerTask);
console.log('hasBugFix:', hasBugFix);

const hasPageInBrowserContext = /\b(page)\b/.test(lowerTask) && !isAppBuildingTask;
console.log('hasPageInBrowserContext:', hasPageInBrowserContext);