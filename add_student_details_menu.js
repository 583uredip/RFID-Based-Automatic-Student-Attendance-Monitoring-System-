const fs = require('fs');
const path = require('path');

const adminDir = 'd:\\Kapataksha-High-School\\Portal\\Admin';

function walkSync(dir, filelist = []) {
  fs.readdirSync(dir).forEach(file => {
    const dirFile = path.join(dir, file);
    if (fs.statSync(dirFile).isDirectory()) {
      filelist = walkSync(dirFile, filelist);
    } else if (dirFile.endsWith('.html')) {
      filelist.push(dirFile);
    }
  });
  return filelist;
}

const htmlFiles = walkSync(adminDir);

let count = 0;
htmlFiles.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  
  // Need to find View All Students block and append Student Details block
  // We can use a regex that matches the View All Students link and captures its prefix spacing.
  const regex = /(<a\s+href="([^"]*ViewAllStudents\.html)"[^>]*>[\s\S]*?<span>View All Students<\/span>\s*<\/a>)/;
  
  if (regex.test(content)) {
    // Check if Student Details is already there
    if (!content.includes('Student Details</span>')) {
      content = content.replace(regex, (match, fullMatch, hrefPath) => {
        // Construct the href for Student Details
        const detailsHref = hrefPath.replace('ViewAllStudents.html', 'StudentDetails.html');
        
        const detailsBlock = `
                        <a href="${detailsHref}" class="sidebar-subitem">
                            <i class="fa-solid fa-address-card subitem-icon"></i>
                            <span>Student Details</span>
                        </a>`;
        return fullMatch + detailsBlock;
      });
      fs.writeFileSync(file, content);
      count++;
    }
  }
});
console.log(`Updated ${count} files.`);
