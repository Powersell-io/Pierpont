// Smart Description Parser — extracts structured data from permit description text
function parsePermitDescription(descriptionText) {
  if (!descriptionText) return { constructionType: null, squareFootage: null, stories: null, subdivision: null, mentionsDrywall: false, mentionsInterior: false, rawKeywords: [] };

  const text = String(descriptionText);
  const lower = text.toLowerCase();
  const keywords = [];

  // Construction type
  let constructionType = null;
  if (lower.includes('single family') || lower.includes('single-family') || lower.includes('sfr') || lower.includes('sfd')) {
    constructionType = 'Single Family'; keywords.push('single family');
  } else if (lower.includes('townhome') || lower.includes('town home') || lower.includes('townhouse')) {
    constructionType = 'Townhome'; keywords.push('townhome');
  } else if (lower.includes('duplex')) {
    constructionType = 'Duplex'; keywords.push('duplex');
  } else if (lower.includes('custom home') || lower.includes('custom build')) {
    constructionType = 'Custom Home'; keywords.push('custom home');
  } else if (lower.includes('condo') || lower.includes('condominium')) {
    constructionType = 'Condominium'; keywords.push('condominium');
  } else if (lower.includes('multi-family') || lower.includes('multifamily') || lower.includes('apartment')) {
    constructionType = 'Multi-Family'; keywords.push('multi-family');
  } else if (lower.includes('residential')) {
    constructionType = 'Residential'; keywords.push('residential');
  }

  // Square footage
  let squareFootage = null;
  const sqftMatch = text.match(/([\d,]+)\s*(?:sq\.?\s*ft\.?|square\s*feet|sf|sqft)/i);
  if (sqftMatch) {
    squareFootage = parseInt(sqftMatch[1].replace(/,/g, ''));
    keywords.push(`${squareFootage} sqft`);
  }

  // Stories
  let stories = null;
  const storiesMatch = text.match(/(\d+)\s*(?:stor(?:y|ies)|floor|level)/i);
  if (storiesMatch) {
    stories = parseInt(storiesMatch[1]);
    keywords.push(`${stories} stories`);
  }

  // Subdivision / development
  let subdivision = null;
  const subMatch = text.match(/(?:subdivision|development|community|neighborhood|phase)[\s:]+([A-Z][A-Za-z\s&'-]+?)(?:\.|,|\n|$)/i);
  if (subMatch) {
    subdivision = subMatch[1].trim();
    keywords.push(subdivision);
  }

  // Drywall / interior mentions
  const mentionsDrywall = lower.includes('drywall') || lower.includes('dry wall') || lower.includes('gypsum') || lower.includes('sheetrock') || lower.includes('wallboard');
  const mentionsInterior = lower.includes('interior') || lower.includes('finish') || lower.includes('trim') || lower.includes('paint') || lower.includes('cabinet');

  if (mentionsDrywall) keywords.push('drywall');
  if (mentionsInterior) keywords.push('interior');

  // Additional keywords
  if (lower.includes('new construction')) keywords.push('new construction');
  if (lower.includes('renovation') || lower.includes('remodel')) keywords.push('renovation');
  if (lower.includes('addition')) keywords.push('addition');
  if (lower.includes('pool')) keywords.push('pool');
  if (lower.includes('garage')) keywords.push('garage');

  return {
    constructionType,
    squareFootage,
    stories,
    subdivision,
    mentionsDrywall,
    mentionsInterior,
    rawKeywords: keywords,
  };
}

module.exports = { parsePermitDescription };
