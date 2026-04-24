export function parseSections(content) {
  if (!content) return [];

  const lines = content.split('\n');
  const sections = [];
  let charIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.length > 0) {
      let sectionTitle = null;

      const mdMatch = trimmed.match(/^#{1,3}\s+(.+)/);
      if (mdMatch) {
        sectionTitle = mdMatch[1].trim();
      }

      if (!sectionTitle) {
        const boldMatch = trimmed.match(/^\*\*(.+?)\*\*$/);
        if (boldMatch) {
          sectionTitle = boldMatch[1].trim();
        }
      }

      if (!sectionTitle) {
        const numMatch = trimmed.match(/^\d+[.)]\s+(.+)/);
        if (numMatch && trimmed.length < 80) {
          sectionTitle = numMatch[1].trim();
        }
      }

      if (!sectionTitle && trimmed.length >= 3 && trimmed.length < 80) {
        const stripped = trimmed.replace(/[^a-zA-Z\s]/g, '').trim();
        if (stripped.length >= 3 && stripped === stripped.toUpperCase() && /[A-Z]/.test(stripped)) {
          sectionTitle = trimmed;
        }
      }

      if (!sectionTitle && trimmed.length < 80 && trimmed.length >= 3) {
        if (trimmed.endsWith(':') && !trimmed.includes(',')) {
          sectionTitle = trimmed.replace(/:$/, '').trim();
        }
      }

      if (sectionTitle) {
        sectionTitle = sectionTitle.replace(/[#*_]/g, '').trim();
        if (sectionTitle.length > 0) {
          sections.push({
            id: `section-${sections.length}`,
            title: sectionTitle,
            startIndex: charIndex,
          });
        }
      }
    }

    charIndex += line.length + 1;
  }

  return sections;
}
