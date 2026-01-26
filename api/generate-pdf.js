import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// Color palette (matching CellarSense branding)
const COLORS = {
  burgundy: rgb(114/255, 47/255, 55/255),
  burgundyLight: rgb(139/255, 58/255, 68/255),
  gold: rgb(201/255, 169/255, 98/255),
  cream: rgb(250/255, 248/255, 245/255),
  creamDark: rgb(237/255, 232/255, 224/255),
  textDark: rgb(45/255, 45/255, 45/255),
  textMedium: rgb(90/255, 90/255, 90/255),
  textLight: rgb(138/255, 138/255, 138/255),
  white: rgb(1, 1, 1),
};

// Page dimensions (Letter size in points)
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = req.body;
    
    // Generate personalized content using Claude API
    const generatedContent = await generateContent(data);
    
    // Create PDF
    const pdfBytes = await createPDF(data, generatedContent);
    
    // Return PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${data.names.replace(/[^a-z0-9]/gi, '_')}_Wine_Guide.pdf"`);
    res.send(Buffer.from(pdfBytes));
    
  } catch (error) {
    console.error('PDF Generation Error:', error);
    res.status(500).json({ error: error.message });
  }
}

// Generate personalized content using Claude API
async function generateContent(data) {
  const prompt = `You are Anthony, a WSET-certified sommelier writing a personalized wedding wine guide. You just had a great consultation call with this couple and now you're writing their custom guide.

CLIENT DETAILS:
- Names: ${data.names}
- Wedding Date: ${data.date}
- Venue: ${data.venue}
- Venue Type: ${data.venueType || 'Not specified'}
- Guest Count: ${data.guests}
- Reception Hours: ${data.hours}
- Budget: $${data.budget}
- Bar Setup: ${data.barType || 'mixed'}
- Vibe/Theme: ${data.vibe || 'Not specified'}
- Food Menu: ${data.food || 'Not specified'}
- Client Preferences: ${data.preferences || 'Not specified'}
- Special Notes from Consultation: ${data.notes || 'Not specified'}

Generate the following content in JSON format. Write naturally and warmly - like you're writing to friends, not clients. Avoid corporate-speak. Never use the word "crafted" - use words like "selected", "put together", "designed" instead.

{
  "personalLetter": "A warm, personal 2-paragraph letter. Start with 'I really enjoyed our chat and am so excited for your ceremony!' Reference specific details they shared (venue, heritage, preferences). Keep it conversational and genuine - like a text from a friend who happens to be a sommelier. End with just 'Best,' (signature added separately). Around 100-150 words total.",
  
  "wines": [
    {
      "category": "Sparkling",
      "name": "Wine varietal name",
      "region": "Wine region",
      "bottle": "Specific bottle recommendation",
      "price": number (price per bottle),
      "narrative": "2-3 sentences about why this wine - written warmly, mentioning how it connects to their event",
      "whyPerfect": "1-2 sentences directly connecting this wine to their specific situation - reference their menu, venue, or preferences",
      "tastingNotes": ["note 1", "note 2", "note 3"],
      "alternatives": [{"name": "Alternative 1", "price": number}, {"name": "Alternative 2", "price": number}]
    },
    // Same structure for White, Red, and Rosé
  ],
  
  "quantities": {
    "sparkling": number (calculate based on ${data.guests} guests, ${data.hours} hours, ${data.barType || 'mixed'} bar - sparkling for toast = guests/6 rounded up),
    "white": number,
    "red": number, 
    "rose": number,
    "total": number
  }
}

QUANTITY CALCULATION GUIDELINES:
- For a mixed bar with ${data.guests} guests over ${data.hours} hours:
- Sparkling: guests ÷ 6 (for toast), round up
- Total still wine: roughly 0.5 bottles per guest for mixed bar
- Split still wine based on their red/white preference (default 50/50)
- Include rosé if it's warm weather or they mentioned liking it (about 15% of still)

WINE SELECTION GUIDELINES:
- Match wines to their budget ($${data.budget} total ÷ quantities = price per bottle target)
- Consider food pairings if menu provided
- Match vibe (rustic = old world, modern = new world, etc.)
- Reference any cultural heritage mentioned
- Popular crowd-pleasers that photograph well

Respond ONLY with valid JSON, no markdown code blocks or explanation.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    })
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const result = await response.json();
  const content = result.content[0].text;
  
  // Parse JSON from response
  try {
    // Remove markdown code blocks if present
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.slice(7);
    }
    if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.slice(3);
    }
    if (cleanContent.endsWith('```')) {
      cleanContent = cleanContent.slice(0, -3);
    }
    return JSON.parse(cleanContent.trim());
  } catch (e) {
    // Try to extract JSON if wrapped in other text
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('Failed to parse AI response: ' + e.message);
  }
}

async function createPDF(data, content) {
  const pdfDoc = await PDFDocument.create();
  
  // Embed fonts
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  
  const fonts = { helvetica, helveticaBold, helveticaOblique, timesRoman, timesItalic, timesBold };
  
  // Calculate totals
  const quantities = content.quantities;
  const wines = content.wines;
  const subtotals = {
    sparkling: quantities.sparkling * (wines.find(w => w.category === 'Sparkling')?.price || 0),
    white: quantities.white * (wines.find(w => w.category === 'White')?.price || 0),
    red: quantities.red * (wines.find(w => w.category === 'Red')?.price || 0),
    rose: quantities.rose * (wines.find(w => w.category === 'Rosé')?.price || 0)
  };
  const subtotal = Object.values(subtotals).reduce((a, b) => a + b, 0);
  const tax = Math.round(subtotal * 0.1);
  const total = subtotal + tax;
  
  // PAGE 1: Cover
  await createCoverPage(pdfDoc, data, fonts);
  
  // PAGE 2: Table of Contents
  await createTOCPage(pdfDoc, fonts);
  
  // PAGE 3: Your Wine Vision (Personal Letter)
  await createVisionPage(pdfDoc, data, content, fonts);
  
  // PAGE 4: Wine Selections (Red & White)
  await createWineSelectionsPage1(pdfDoc, content.wines, fonts);
  
  // PAGE 5: Wine Selections (Sparkling & Rosé)
  await createWineSelectionsPage2(pdfDoc, content.wines, fonts);
  
  // PAGE 6: Day-of Timeline
  await createTimelinePage(pdfDoc, fonts);
  
  // PAGE 7: Where to Buy & Alternatives
  await createWhereToBuyPage(pdfDoc, content.wines, data.location, fonts);
  
  // PAGE 8: Quantities & Budget
  await createBudgetPage(pdfDoc, quantities, wines, subtotals, subtotal, tax, total, fonts);
  
  return await pdfDoc.save();
}

// ============================================
// PAGE 1: COVER
// ============================================
async function createCoverPage(pdfDoc, data, fonts) {
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  
  // Burgundy background
  page.drawRectangle({
    x: 0, y: 0,
    width: PAGE_WIDTH, height: PAGE_HEIGHT,
    color: COLORS.burgundy
  });
  
  // "CellarSense.ai" at top
  const topText = 'CellarSense.ai';
  const topWidth = fonts.helvetica.widthOfTextAtSize(topText, 10);
  page.drawText(topText, {
    x: (PAGE_WIDTH - topWidth) / 2,
    y: PAGE_HEIGHT - 60,
    size: 10,
    font: fonts.helvetica,
    color: COLORS.gold
  });
  
  // "Designed by a WSET-Certified Sommelier"
  const credText = 'Designed by a WSET-Certified Sommelier';
  const credWidth = fonts.timesItalic.widthOfTextAtSize(credText, 10);
  page.drawText(credText, {
    x: (PAGE_WIDTH - credWidth) / 2,
    y: PAGE_HEIGHT - 75,
    size: 10,
    font: fonts.timesItalic,
    color: COLORS.gold
  });
  
  // "CELLARSENSE" header
  const headerText = 'C E L L A R S E N S E';
  const headerWidth = fonts.helvetica.widthOfTextAtSize(headerText, 11);
  page.drawText(headerText, {
    x: (PAGE_WIDTH - headerWidth) / 2,
    y: PAGE_HEIGHT - 300,
    size: 11,
    font: fonts.helvetica,
    color: COLORS.gold
  });
  
  // Main title
  const title1 = 'Your Wedding';
  const title2 = 'Wine Guide';
  const title1Width = fonts.timesRoman.widthOfTextAtSize(title1, 48);
  const title2Width = fonts.timesRoman.widthOfTextAtSize(title2, 48);
  
  page.drawText(title1, {
    x: (PAGE_WIDTH - title1Width) / 2,
    y: PAGE_HEIGHT - 370,
    size: 48,
    font: fonts.timesRoman,
    color: COLORS.white
  });
  
  page.drawText(title2, {
    x: (PAGE_WIDTH - title2Width) / 2,
    y: PAGE_HEIGHT - 420,
    size: 48,
    font: fonts.timesRoman,
    color: COLORS.white
  });
  
  // Subtitle
  const subtitle = `Prepared exclusively for ${data.names}`;
  const subtitleWidth = fonts.timesItalic.widthOfTextAtSize(subtitle, 16);
  page.drawText(subtitle, {
    x: (PAGE_WIDTH - subtitleWidth) / 2,
    y: PAGE_HEIGHT - 470,
    size: 16,
    font: fonts.timesItalic,
    color: COLORS.white
  });
  
  // Gold divider line
  page.drawLine({
    start: { x: PAGE_WIDTH/2 - 40, y: PAGE_HEIGHT - 500 },
    end: { x: PAGE_WIDTH/2 + 40, y: PAGE_HEIGHT - 500 },
    thickness: 1,
    color: COLORS.gold
  });
  
  // Date and venue
  const formattedDate = data.date ? new Date(data.date).toLocaleDateString('en-US', { 
    month: 'long', day: 'numeric', year: 'numeric' 
  }) : '';
  
  if (formattedDate) {
    const dateWidth = fonts.helvetica.widthOfTextAtSize(formattedDate, 12);
    page.drawText(formattedDate, {
      x: (PAGE_WIDTH - dateWidth) / 2,
      y: PAGE_HEIGHT - 530,
      size: 12,
      font: fonts.helvetica,
      color: COLORS.white
    });
  }
  
  if (data.venue) {
    const venueWidth = fonts.helvetica.widthOfTextAtSize(data.venue, 12);
    page.drawText(data.venue, {
      x: (PAGE_WIDTH - venueWidth) / 2,
      y: PAGE_HEIGHT - 550,
      size: 12,
      font: fonts.helvetica,
      color: COLORS.white
    });
  }
  
  // Footer
  const footerText = 'CellarSense.ai';
  const footerWidth = fonts.helvetica.widthOfTextAtSize(footerText, 10);
  page.drawText(footerText, {
    x: (PAGE_WIDTH - footerWidth) / 2,
    y: 60,
    size: 10,
    font: fonts.helvetica,
    color: COLORS.gold
  });
  
  const footerCred = 'Designed by a WSET-Certified Sommelier';
  const footerCredWidth = fonts.timesItalic.widthOfTextAtSize(footerCred, 10);
  page.drawText(footerCred, {
    x: (PAGE_WIDTH - footerCredWidth) / 2,
    y: 45,
    size: 10,
    font: fonts.timesItalic,
    color: COLORS.gold
  });
}

// ============================================
// PAGE 2: TABLE OF CONTENTS
// ============================================
async function createTOCPage(pdfDoc, fonts) {
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  
  // Cream background
  page.drawRectangle({
    x: 0, y: 0,
    width: PAGE_WIDTH, height: PAGE_HEIGHT,
    color: COLORS.cream
  });
  
  // Title
  const title = "What's Inside";
  const titleWidth = fonts.timesRoman.widthOfTextAtSize(title, 32);
  page.drawText(title, {
    x: (PAGE_WIDTH - titleWidth) / 2,
    y: PAGE_HEIGHT - 100,
    size: 32,
    font: fonts.timesRoman,
    color: COLORS.burgundy
  });
  
  // Gold divider
  page.drawLine({
    start: { x: PAGE_WIDTH/2 - 30, y: PAGE_HEIGHT - 120 },
    end: { x: PAGE_WIDTH/2 + 30, y: PAGE_HEIGHT - 120 },
    thickness: 1,
    color: COLORS.gold
  });
  
  // TOC items
  const tocItems = [
    { title: 'Your Wine Vision', page: '3' },
    { title: 'Our Selections for You', page: '4–5' },
    { title: 'Day-of Timeline', page: '6' },
    { title: 'Where to Buy & Alternatives', page: '7' },
    { title: 'Quantities & Budget', page: '8' }
  ];
  
  let y = PAGE_HEIGHT - 200;
  tocItems.forEach(item => {
    page.drawText(item.title, {
      x: 120,
      y: y,
      size: 14,
      font: fonts.helvetica,
      color: COLORS.textDark
    });
    
    page.drawText(item.page, {
      x: PAGE_WIDTH - 120,
      y: y,
      size: 14,
      font: fonts.helvetica,
      color: COLORS.textMedium
    });
    
    y -= 35;
  });
  
  // Intro text
  const introText = 'This guide was created specifically for your celebration, taking into account your venue, guest count, personal preferences, and vision for the day. Every recommendation reflects both the art of wine selection and the practical realities of hosting.';
  const introLines = wrapText(introText, fonts.timesItalic, 11, PAGE_WIDTH - 160);
  
  y = 200;
  introLines.forEach(line => {
    const lineWidth = fonts.timesItalic.widthOfTextAtSize(line, 11);
    page.drawText(line, {
      x: (PAGE_WIDTH - lineWidth) / 2,
      y: y,
      size: 11,
      font: fonts.timesItalic,
      color: COLORS.textMedium
    });
    y -= 16;
  });
  
  // Page number
  page.drawText('2', {
    x: PAGE_WIDTH / 2 - 5,
    y: 40,
    size: 10,
    font: fonts.helvetica,
    color: COLORS.textLight
  });
}

// ============================================
// PAGE 3: YOUR WINE VISION
// ============================================
async function createVisionPage(pdfDoc, data, content, fonts) {
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  
  // Cream background
  page.drawRectangle({
    x: 0, y: 0,
    width: PAGE_WIDTH, height: PAGE_HEIGHT,
    color: COLORS.cream
  });
  
  // Title
  const title = 'Your Wine Vision';
  const titleWidth = fonts.timesRoman.widthOfTextAtSize(title, 32);
  page.drawText(title, {
    x: (PAGE_WIDTH - titleWidth) / 2,
    y: PAGE_HEIGHT - 70,
    size: 32,
    font: fonts.timesRoman,
    color: COLORS.burgundy
  });
  
  // Subtitle
  const subtitle = 'Understanding Your Celebration';
  const subtitleWidth = fonts.timesItalic.widthOfTextAtSize(subtitle, 14);
  page.drawText(subtitle, {
    x: (PAGE_WIDTH - subtitleWidth) / 2,
    y: PAGE_HEIGHT - 92,
    size: 14,
    font: fonts.timesItalic,
    color: COLORS.textMedium
  });
  
  // Gold divider
  page.drawLine({
    start: { x: PAGE_WIDTH/2 - 30, y: PAGE_HEIGHT - 110 },
    end: { x: PAGE_WIDTH/2 + 30, y: PAGE_HEIGHT - 110 },
    thickness: 1,
    color: COLORS.gold
  });
  
  // Letter box (white background)
  const letterBoxTop = PAGE_HEIGHT - 140;
  const letterBoxHeight = 320;
  page.drawRectangle({
    x: MARGIN,
    y: letterBoxTop - letterBoxHeight,
    width: PAGE_WIDTH - MARGIN * 2,
    height: letterBoxHeight,
    color: COLORS.white
  });
  
  // Letter content
  let y = letterBoxTop - 30;
  
  // Greeting
  const greeting = `${data.names} —`;
  page.drawText(greeting, {
    x: MARGIN + 25,
    y: y,
    size: 16,
    font: fonts.timesBold,
    color: COLORS.burgundy
  });
  
  y -= 30;
  
  // Personal letter
  const letterLines = wrapText(content.personalLetter, fonts.timesRoman, 11, PAGE_WIDTH - MARGIN * 2 - 50);
  letterLines.forEach(line => {
    page.drawText(line, {
      x: MARGIN + 25,
      y: y,
      size: 11,
      font: fonts.timesRoman,
      color: COLORS.textDark
    });
    y -= 16;
  });
  
  // Signature section
  y -= 15;
  page.drawText('Best,', {
    x: MARGIN + 25,
    y: y,
    size: 11,
    font: fonts.timesRoman,
    color: COLORS.textMedium
  });
  
  // Signature image would go here - for now, just the name
  y -= 50;
  page.drawText('Anthony', {
    x: MARGIN + 25,
    y: y,
    size: 14,
    font: fonts.timesItalic,
    color: COLORS.burgundy
  });
  
  // Event details grid
  const detailsBoxY = 220;
  const details = [
    { label: 'GUEST COUNT', value: `${data.guests} Guests` },
    { label: 'RECEPTION', value: `${data.hours} Hours` },
    { label: 'BAR STYLE', value: getBarTypeLabel(data.barType) },
    { label: 'VENUE', value: data.venueType || data.venue || 'Venue' }
  ];
  
  const colWidth = (PAGE_WIDTH - MARGIN * 2) / 2;
  details.forEach((detail, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN + col * colWidth + 20;
    const yPos = detailsBoxY - row * 55;
    
    page.drawText(detail.label, {
      x: x,
      y: yPos + 3,
      size: 8,
      font: fonts.helvetica,
      color: COLORS.textLight
    });
    
    page.drawText(detail.value, {
      x: x,
      y: yPos - 12,
      size: 12,
      font: fonts.helveticaBold,
      color: COLORS.textDark
    });
  });
  
  // Page number
  page.drawText('3', {
    x: PAGE_WIDTH / 2 - 5,
    y: 40,
    size: 10,
    font: fonts.helvetica,
    color: COLORS.textLight
  });
}

// ============================================
// PAGE 4: WINE SELECTIONS (Red & White)
// ============================================
async function createWineSelectionsPage1(pdfDoc, wines, fonts) {
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  
  // Cream background
  page.drawRectangle({
    x: 0, y: 0,
    width: PAGE_WIDTH, height: PAGE_HEIGHT,
    color: COLORS.cream
  });
  
  // Title
  const title = 'Our Selections for You';
  const titleWidth = fonts.timesRoman.widthOfTextAtSize(title, 28);
  page.drawText(title, {
    x: (PAGE_WIDTH - titleWidth) / 2,
    y: PAGE_HEIGHT - 55,
    size: 28,
    font: fonts.timesRoman,
    color: COLORS.burgundy
  });
  
  // Subtitle
  const subtitle = 'Thoughtfully chosen to complement your celebration';
  const subtitleWidth = fonts.timesItalic.widthOfTextAtSize(subtitle, 11);
  page.drawText(subtitle, {
    x: (PAGE_WIDTH - subtitleWidth) / 2,
    y: PAGE_HEIGHT - 75,
    size: 11,
    font: fonts.timesItalic,
    color: COLORS.textMedium
  });
  
  // Red wine
  const redWine = wines.find(w => w.category === 'Red');
  if (redWine) {
    drawWineCard(page, redWine, PAGE_HEIGHT - 110, fonts);
  }
  
  // White wine
  const whiteWine = wines.find(w => w.category === 'White');
  if (whiteWine) {
    drawWineCard(page, whiteWine, PAGE_HEIGHT - 430, fonts);
  }
  
  // Page number
  page.drawText('4', {
    x: PAGE_WIDTH / 2 - 5,
    y: 40,
    size: 10,
    font: fonts.helvetica,
    color: COLORS.textLight
  });
}

// ============================================
// PAGE 5: WINE SELECTIONS (Sparkling & Rosé)
// ============================================
async function createWineSelectionsPage2(pdfDoc, wines, fonts) {
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  
  // Cream background
  page.drawRectangle({
    x: 0, y: 0,
    width: PAGE_WIDTH, height: PAGE_HEIGHT,
    color: COLORS.cream
  });
  
  // Title
  const title = 'Our Selections for You';
  const titleWidth = fonts.timesRoman.widthOfTextAtSize(title, 28);
  page.drawText(title, {
    x: (PAGE_WIDTH - titleWidth) / 2,
    y: PAGE_HEIGHT - 55,
    size: 28,
    font: fonts.timesRoman,
    color: COLORS.burgundy
  });
  
  // Subtitle
  const subtitle = 'Continued';
  const subtitleWidth = fonts.timesItalic.widthOfTextAtSize(subtitle, 11);
  page.drawText(subtitle, {
    x: (PAGE_WIDTH - subtitleWidth) / 2,
    y: PAGE_HEIGHT - 75,
    size: 11,
    font: fonts.timesItalic,
    color: COLORS.textMedium
  });
  
  // Sparkling wine
  const sparklingWine = wines.find(w => w.category === 'Sparkling');
  if (sparklingWine) {
    drawWineCard(page, sparklingWine, PAGE_HEIGHT - 110, fonts);
  }
  
  // Rosé wine
  const roseWine = wines.find(w => w.category === 'Rosé');
  if (roseWine) {
    drawWineCard(page, roseWine, PAGE_HEIGHT - 430, fonts);
  }
  
  // Page number
  page.drawText('5', {
    x: PAGE_WIDTH / 2 - 5,
    y: 40,
    size: 10,
    font: fonts.helvetica,
    color: COLORS.textLight
  });
}

// Helper: Draw wine card
function drawWineCard(page, wine, startY, fonts) {
  const cardWidth = PAGE_WIDTH - MARGIN * 2;
  const cardHeight = 300;
  
  // White card background
  page.drawRectangle({
    x: MARGIN,
    y: startY - cardHeight,
    width: cardWidth,
    height: cardHeight,
    color: COLORS.white
  });
  
  let y = startY - 25;
  
  // Category label (with burgundy background)
  page.drawRectangle({
    x: MARGIN + 15,
    y: y - 5,
    width: 70,
    height: 18,
    color: COLORS.burgundy
  });
  
  page.drawText(wine.category.toUpperCase(), {
    x: MARGIN + 20,
    y: y,
    size: 9,
    font: fonts.helveticaBold,
    color: COLORS.white
  });
  
  y -= 35;
  
  // Wine name
  page.drawText(wine.name, {
    x: MARGIN + 20,
    y: y,
    size: 20,
    font: fonts.timesBold,
    color: COLORS.textDark
  });
  
  y -= 18;
  
  // Region
  page.drawText(wine.region, {
    x: MARGIN + 20,
    y: y,
    size: 11,
    font: fonts.timesItalic,
    color: COLORS.textMedium
  });
  
  y -= 20;
  
  // Bottle and price
  page.drawText(wine.bottle, {
    x: MARGIN + 20,
    y: y,
    size: 11,
    font: fonts.helveticaBold,
    color: COLORS.textDark
  });
  
  const priceText = `~$${wine.price}/bottle`;
  page.drawText(priceText, {
    x: MARGIN + 20 + fonts.helveticaBold.widthOfTextAtSize(wine.bottle, 11) + 15,
    y: y,
    size: 11,
    font: fonts.helvetica,
    color: COLORS.textMedium
  });
  
  y -= 25;
  
  // Narrative
  const narrativeLines = wrapText(wine.narrative, fonts.timesRoman, 10, cardWidth - 45);
  narrativeLines.forEach(line => {
    page.drawText(line, {
      x: MARGIN + 20,
      y: y,
      size: 10,
      font: fonts.timesRoman,
      color: COLORS.textMedium
    });
    y -= 14;
  });
  
  y -= 8;
  
  // "Why this is perfect" box
  const whyBoxHeight = 50;
  page.drawRectangle({
    x: MARGIN + 15,
    y: y - whyBoxHeight,
    width: cardWidth - 30,
    height: whyBoxHeight,
    color: rgb(253/255, 250/255, 245/255)
  });
  
  // Gold left border
  page.drawRectangle({
    x: MARGIN + 15,
    y: y - whyBoxHeight,
    width: 3,
    height: whyBoxHeight,
    color: COLORS.gold
  });
  
  page.drawText('Why this is perfect:', {
    x: MARGIN + 25,
    y: y - 15,
    size: 9,
    font: fonts.helveticaBold,
    color: COLORS.burgundy
  });
  
  const whyLines = wrapText(wine.whyPerfect, fonts.timesItalic, 9, cardWidth - 60);
  let whyY = y - 28;
  whyLines.slice(0, 2).forEach(line => {
    page.drawText(line, {
      x: MARGIN + 25,
      y: whyY,
      size: 9,
      font: fonts.timesItalic,
      color: COLORS.textMedium
    });
    whyY -= 12;
  });
  
  y -= whyBoxHeight + 15;
  
  // Tasting Notes header
  page.drawText('Tasting Notes', {
    x: MARGIN + 20,
    y: y,
    size: 10,
    font: fonts.helveticaBold,
    color: COLORS.textDark
  });
  
  y -= 18;
  
  // Tasting notes
  if (wine.tastingNotes) {
    wine.tastingNotes.forEach(note => {
      page.drawText(`• ${note}`, {
        x: MARGIN + 20,
        y: y,
        size: 9,
        font: fonts.helvetica,
        color: COLORS.textMedium
      });
      y -= 14;
    });
  }
}

// ============================================
// PAGE 6: DAY-OF TIMELINE
// ============================================
async function createTimelinePage(pdfDoc, fonts) {
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  
  // Cream background
  page.drawRectangle({
    x: 0, y: 0,
    width: PAGE_WIDTH, height: PAGE_HEIGHT,
    color: COLORS.cream
  });
  
  // Title
  const title = 'Day-of Timeline';
  const titleWidth = fonts.timesRoman.widthOfTextAtSize(title, 28);
  page.drawText(title, {
    x: (PAGE_WIDTH - titleWidth) / 2,
    y: PAGE_HEIGHT - 55,
    size: 28,
    font: fonts.timesRoman,
    color: COLORS.burgundy
  });
  
  // Subtitle
  const subtitle = "A sommelier's guide to wine service";
  const subtitleWidth = fonts.timesItalic.widthOfTextAtSize(subtitle, 11);
  page.drawText(subtitle, {
    x: (PAGE_WIDTH - subtitleWidth) / 2,
    y: PAGE_HEIGHT - 75,
    size: 11,
    font: fonts.timesItalic,
    color: COLORS.textMedium
  });
  
  const timeline = [
    { time: '3-4 hours\nbefore', title: 'Chill the whites and rosé', desc: 'Place white wine and rosé in refrigeration. Aim for 45-50°F serving temperature. If using ice buckets, fill them now so ice has time to melt slightly (pure ice is too cold).' },
    { time: '2-3 hours\nbefore', title: 'Chill the sparkling wine', desc: 'Champagne and sparkling wines should be well-chilled to 40-45°F. This is colder than white wine. Keep bottles in ice buckets until ready to pour for the toast.' },
    { time: '1 hour\nbefore', title: 'Set out the red wine', desc: 'Red wine should be served at "cellar temperature" (60-65°F), slightly cooler than room temperature. If stored in a cool place, set out now. If room temperature, 15 minutes in the fridge won\'t hurt.' },
    { time: '30 min\nbefore', title: 'Open red wines to breathe', desc: 'Open 2-3 bottles of red wine to let them breathe. For full-bodied reds, this allows tannins to soften. Simply removing the cork is sufficient; decanting is optional but impressive.' },
    { time: 'Toast time', title: 'Pour sparkling for the toast', desc: 'Fill flutes about two-thirds full. Pour slowly down the side of the glass to preserve bubbles. Have servers positioned to distribute quickly so bubbles stay lively.' },
    { time: 'During\ndinner', title: 'Keep wines at temperature', desc: 'Rotate white and rosé bottles between ice buckets and service. Red wine at the bar is fine at room temperature. Watch for whites getting too warm on tables.' }
  ];
  
  let y = PAGE_HEIGHT - 130;
  timeline.forEach(item => {
    // Time column
    const timeLines = item.time.split('\n');
    timeLines.forEach((timeLine, i) => {
      page.drawText(timeLine, {
        x: MARGIN,
        y: y - (i * 12),
        size: 10,
        font: fonts.helveticaBold,
        color: COLORS.burgundy
      });
    });
    
    // Title
    page.drawText(item.title, {
      x: 150,
      y: y,
      size: 11,
      font: fonts.helveticaBold,
      color: COLORS.textDark
    });
    
    // Description
    const descLines = wrapText(item.desc, fonts.helvetica, 9, 400);
    descLines.forEach((line, i) => {
      page.drawText(line, {
        x: 150,
        y: y - 15 - (i * 12),
        size: 9,
        font: fonts.helvetica,
        color: COLORS.textMedium
      });
    });
    
    y -= Math.max(60, 15 + descLines.length * 12 + 20);
  });
  
  // Page number
  page.drawText('6', {
    x: PAGE_WIDTH / 2 - 5,
    y: 40,
    size: 10,
    font: fonts.helvetica,
    color: COLORS.textLight
  });
}

// ============================================
// PAGE 7: WHERE TO BUY & ALTERNATIVES
// ============================================
async function createWhereToBuyPage(pdfDoc, wines, location, fonts) {
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  
  // Cream background
  page.drawRectangle({
    x: 0, y: 0,
    width: PAGE_WIDTH, height: PAGE_HEIGHT,
    color: COLORS.cream
  });
  
  // Title
  const title = 'Where to Buy';
  const titleWidth = fonts.timesRoman.widthOfTextAtSize(title, 28);
  page.drawText(title, {
    x: (PAGE_WIDTH - titleWidth) / 2,
    y: PAGE_HEIGHT - 55,
    size: 28,
    font: fonts.timesRoman,
    color: COLORS.burgundy
  });
  
  // Subtitle
  const subtitle = "Plus alternatives if your first choice isn't available";
  const subtitleWidth = fonts.timesItalic.widthOfTextAtSize(subtitle, 11);
  page.drawText(subtitle, {
    x: (PAGE_WIDTH - subtitleWidth) / 2,
    y: PAGE_HEIGHT - 75,
    size: 11,
    font: fonts.timesItalic,
    color: COLORS.textMedium
  });
  
  // Gold divider
  page.drawLine({
    start: { x: PAGE_WIDTH/2 - 30, y: PAGE_HEIGHT - 90 },
    end: { x: PAGE_WIDTH/2 + 30, y: PAGE_HEIGHT - 90 },
    thickness: 1,
    color: COLORS.gold
  });
  
  // Online retailers section
  page.drawText('Online Retailers', {
    x: MARGIN,
    y: PAGE_HEIGHT - 120,
    size: 12,
    font: fonts.helveticaBold,
    color: COLORS.burgundy
  });
  
  const retailers = [
    { name: 'Wine.com', url: 'wine.com', note: 'Wide selection, reliable shipping. Often has case discounts. Check delivery lead times for your date.' },
    { name: 'Total Wine & More', url: 'totalwine.com', note: 'Great prices, in-store pickup available. Call ahead for large orders to ensure stock.' },
    { name: 'Vivino', url: 'vivino.com', note: 'Compare prices across retailers. User reviews helpful for finding alternatives.' },
    { name: 'K&L Wine Merchants', url: 'klwines.com', note: 'Excellent for premium and imported wines. Knowledgeable staff for substitutions.' }
  ];
  
  let y = PAGE_HEIGHT - 150;
  const colWidth = (PAGE_WIDTH - MARGIN * 2 - 15) / 2;
  
  retailers.forEach((r, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN + col * (colWidth + 15);
    const yPos = y - row * 70;
    
    // Card background
    page.drawRectangle({
      x: x,
      y: yPos - 55,
      width: colWidth,
      height: 60,
      color: COLORS.white
    });
    
    page.drawText(r.name, {
      x: x + 10,
      y: yPos - 12,
      size: 11,
      font: fonts.helveticaBold,
      color: COLORS.textDark
    });
    
    page.drawText(r.url, {
      x: x + 10,
      y: yPos - 26,
      size: 9,
      font: fonts.helvetica,
      color: COLORS.burgundy
    });
    
    const noteLines = wrapText(r.note, fonts.helvetica, 8, colWidth - 20);
    noteLines.slice(0, 2).forEach((line, li) => {
      page.drawText(line, {
        x: x + 10,
        y: yPos - 40 - (li * 10),
        size: 8,
        font: fonts.helvetica,
        color: COLORS.textMedium
      });
    });
  });
  
  // Local option box
  y = PAGE_HEIGHT - 310;
  page.drawRectangle({
    x: MARGIN,
    y: y - 45,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 45,
    color: COLORS.white,
    borderColor: COLORS.creamDark,
    borderWidth: 1
  });
  
  page.drawText('Local Option', {
    x: MARGIN,
    y: y + 10,
    size: 12,
    font: fonts.helveticaBold,
    color: COLORS.burgundy
  });
  
  page.drawText('Your Local Wine Shop', {
    x: (PAGE_WIDTH) / 2,
    y: y - 15,
    size: 11,
    font: fonts.helveticaBold,
    color: COLORS.burgundy
  });
  
  const localNote = 'We recommend calling ahead to check availability and ask about case discounts for your wedding order.';
  const localNoteWidth = fonts.timesItalic.widthOfTextAtSize(localNote, 9);
  page.drawText(localNote, {
    x: (PAGE_WIDTH - localNoteWidth) / 2,
    y: y - 32,
    size: 9,
    font: fonts.timesItalic,
    color: COLORS.textMedium
  });
  
  // Alternatives section
  y = PAGE_HEIGHT - 390;
  page.drawText("If You Can't Find Our First Choice", {
    x: MARGIN,
    y: y,
    size: 12,
    font: fonts.helveticaBold,
    color: COLORS.burgundy
  });
  
  y -= 30;
  
  wines.forEach(wine => {
    // Card background
    page.drawRectangle({
      x: MARGIN,
      y: y - 55,
      width: PAGE_WIDTH - MARGIN * 2,
      height: 60,
      color: COLORS.white
    });
    
    // Category label
    page.drawText(wine.category.toUpperCase(), {
      x: MARGIN + 10,
      y: y - 12,
      size: 8,
      font: fonts.helveticaBold,
      color: COLORS.burgundy
    });
    
    // Original pick
    page.drawText(wine.bottle, {
      x: MARGIN + 10,
      y: y - 28,
      size: 10,
      font: fonts.helvetica,
      color: COLORS.textDark
    });
    
    page.drawText(`~$${wine.price}`, {
      x: MARGIN + 10,
      y: y - 42,
      size: 9,
      font: fonts.helvetica,
      color: COLORS.textMedium
    });
    
    // Arrow
    page.drawText('->', {
      x: 200,
      y: y - 32,
      size: 14,
      font: fonts.helvetica,
      color: COLORS.textLight
    });
    
    // Alternatives
    if (wine.alternatives && wine.alternatives.length > 0) {
      wine.alternatives.forEach((alt, i) => {
        const altX = 230 + i * 150;
        page.drawText(alt.name, {
          x: altX,
          y: y - 28,
          size: 9,
          font: fonts.helvetica,
          color: COLORS.textDark
        });
        page.drawText(`~$${alt.price}`, {
          x: altX,
          y: y - 42,
          size: 8,
          font: fonts.helvetica,
          color: COLORS.textMedium
        });
        
        if (i < wine.alternatives.length - 1) {
          page.drawText('or', {
            x: altX + 110,
            y: y - 35,
            size: 9,
            font: fonts.timesItalic,
            color: COLORS.textLight
          });
        }
      });
    }
    
    y -= 70;
  });
  
  // Page number
  page.drawText('7', {
    x: PAGE_WIDTH / 2 - 5,
    y: 40,
    size: 10,
    font: fonts.helvetica,
    color: COLORS.textLight
  });
}

// ============================================
// PAGE 8: QUANTITIES & BUDGET
// ============================================
async function createBudgetPage(pdfDoc, quantities, wines, subtotals, subtotal, tax, total, fonts) {
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  
  // Cream background
  page.drawRectangle({
    x: 0, y: 0,
    width: PAGE_WIDTH, height: PAGE_HEIGHT,
    color: COLORS.cream
  });
  
  // Title
  const title = 'Quantities & Budget';
  const titleWidth = fonts.timesRoman.widthOfTextAtSize(title, 28);
  page.drawText(title, {
    x: (PAGE_WIDTH - titleWidth) / 2,
    y: PAGE_HEIGHT - 55,
    size: 28,
    font: fonts.timesRoman,
    color: COLORS.burgundy
  });
  
  // Subtitle
  const subtitle = 'Everything you need to bring this vision to life';
  const subtitleWidth = fonts.timesItalic.widthOfTextAtSize(subtitle, 11);
  page.drawText(subtitle, {
    x: (PAGE_WIDTH - subtitleWidth) / 2,
    y: PAGE_HEIGHT - 75,
    size: 11,
    font: fonts.timesItalic,
    color: COLORS.textMedium
  });
  
  // Quantities section header
  page.drawText('Recommended Quantities', {
    x: MARGIN,
    y: PAGE_HEIGHT - 115,
    size: 12,
    font: fonts.helveticaBold,
    color: COLORS.burgundy
  });
  
  // Quantity boxes
  const qtyItems = [
    { label: 'Sparkling', value: quantities.sparkling },
    { label: 'White', value: quantities.white },
    { label: 'Red', value: quantities.red },
    { label: 'Rosé', value: quantities.rose },
    { label: 'Total', value: quantities.total, highlight: true }
  ];
  
  const boxWidth = (PAGE_WIDTH - MARGIN * 2 - 40) / 5;
  let x = MARGIN;
  const boxY = PAGE_HEIGHT - 195;
  
  qtyItems.forEach((item, i) => {
    // Box background
    page.drawRectangle({
      x: x,
      y: boxY,
      width: boxWidth,
      height: 70,
      color: item.highlight ? COLORS.burgundy : COLORS.white
    });
    
    // Label
    const labelWidth = fonts.helvetica.widthOfTextAtSize(item.label, 9);
    page.drawText(item.label, {
      x: x + (boxWidth - labelWidth) / 2,
      y: boxY + 55,
      size: 9,
      font: fonts.helvetica,
      color: item.highlight ? COLORS.white : COLORS.textLight
    });
    
    // Value
    const valueStr = String(item.value);
    const valueWidth = fonts.helveticaBold.widthOfTextAtSize(valueStr, 24);
    page.drawText(valueStr, {
      x: x + (boxWidth - valueWidth) / 2,
      y: boxY + 20,
      size: 24,
      font: fonts.helveticaBold,
      color: item.highlight ? COLORS.white : COLORS.burgundy
    });
    
    x += boxWidth + 10;
  });
  
  // Budget section
  const budgetY = PAGE_HEIGHT - 280;
  page.drawText('Event Budget', {
    x: MARGIN,
    y: budgetY,
    size: 12,
    font: fonts.helveticaBold,
    color: COLORS.burgundy
  });
  
  // Budget table background
  page.drawRectangle({
    x: PAGE_WIDTH / 2 + 20,
    y: budgetY - 130,
    width: PAGE_WIDTH / 2 - MARGIN - 20,
    height: 130,
    color: COLORS.white
  });
  
  // Budget items
  const sparklingWine = wines.find(w => w.category === 'Sparkling');
  const whiteWine = wines.find(w => w.category === 'White');
  const redWine = wines.find(w => w.category === 'Red');
  const roseWine = wines.find(w => w.category === 'Rosé');
  
  const budgetItems = [
    { label: `Sparkling (${quantities.sparkling} × $${sparklingWine?.price || 0})`, value: subtotals.sparkling },
    { label: `White (${quantities.white} × $${whiteWine?.price || 0})`, value: subtotals.white },
    { label: `Red (${quantities.red} × $${redWine?.price || 0})`, value: subtotals.red },
    { label: `Rosé (${quantities.rose} × $${roseWine?.price || 0})`, value: subtotals.rose }
  ];
  
  let budgetItemY = budgetY - 20;
  const rightColX = PAGE_WIDTH / 2 + 30;
  
  budgetItems.forEach(item => {
    page.drawText(item.label, {
      x: rightColX,
      y: budgetItemY,
      size: 10,
      font: fonts.helvetica,
      color: COLORS.textDark
    });
    
    page.drawText(`$${item.value.toLocaleString()}`, {
      x: PAGE_WIDTH - MARGIN - 50,
      y: budgetItemY,
      size: 10,
      font: fonts.helvetica,
      color: COLORS.textDark
    });
    
    budgetItemY -= 20;
  });
  
  // Subtotal line
  budgetItemY -= 5;
  page.drawLine({
    start: { x: rightColX, y: budgetItemY + 5 },
    end: { x: PAGE_WIDTH - MARGIN, y: budgetItemY + 5 },
    thickness: 0.5,
    color: COLORS.creamDark
  });
  
  budgetItemY -= 15;
  page.drawText('Subtotal', {
    x: rightColX,
    y: budgetItemY,
    size: 10,
    font: fonts.helveticaBold,
    color: COLORS.textDark
  });
  page.drawText(`$${subtotal.toLocaleString()}`, {
    x: PAGE_WIDTH - MARGIN - 50,
    y: budgetItemY,
    size: 10,
    font: fonts.helveticaBold,
    color: COLORS.textDark
  });
  
  // Tax
  budgetItemY -= 18;
  page.drawText('Sales Tax (est. 10%)', {
    x: rightColX + 10,
    y: budgetItemY,
    size: 9,
    font: fonts.timesItalic,
    color: COLORS.textMedium
  });
  page.drawText(`$${tax.toLocaleString()}`, {
    x: PAGE_WIDTH - MARGIN - 50,
    y: budgetItemY,
    size: 9,
    font: fonts.timesItalic,
    color: COLORS.textMedium
  });
  
  // Total
  budgetItemY -= 25;
  page.drawRectangle({
    x: rightColX - 10,
    y: budgetItemY - 8,
    width: PAGE_WIDTH - MARGIN - rightColX + 10,
    height: 28,
    color: COLORS.burgundy
  });
  
  page.drawText('Estimated Total', {
    x: rightColX,
    y: budgetItemY,
    size: 11,
    font: fonts.helveticaBold,
    color: COLORS.white
  });
  page.drawText(`$${total.toLocaleString()}`, {
    x: PAGE_WIDTH - MARGIN - 50,
    y: budgetItemY,
    size: 11,
    font: fonts.helveticaBold,
    color: COLORS.white
  });
  
  // Pro Tips section
  const tipsY = PAGE_HEIGHT - 460;
  page.drawText('Pro Tips', {
    x: MARGIN,
    y: tipsY,
    size: 12,
    font: fonts.helveticaBold,
    color: COLORS.burgundy
  });
  
  const tips = [
    '* Order 10-15% extra to ensure you don\'t run short. Most retailers accept returns on unopened bottles. Plus, it\'s always fun to celebrate future anniversaries with your wedding wine!',
    '* Ask about case discounts when ordering 12+ bottles of the same wine.',
    '* Plan for one bottle opener per 50 guests and plenty of ice for white wine buckets.',
    '* Order wines 2-3 weeks ahead to ensure availability, especially for specific vintages.'
  ];
  
  let tipY = tipsY - 25;
  tips.forEach(tip => {
    const tipLines = wrapText(tip, fonts.helvetica, 9, PAGE_WIDTH - MARGIN * 2 - 20);
    tipLines.forEach(line => {
      page.drawText(line, {
        x: MARGIN + 10,
        y: tipY,
        size: 9,
        font: fonts.helvetica,
        color: COLORS.textMedium
      });
      tipY -= 14;
    });
    tipY -= 8;
  });
  
  // Footer
  const footerY = 70;
  
  const footerText = 'C E L L A R S E N S E';
  const footerWidth = fonts.helvetica.widthOfTextAtSize(footerText, 10);
  page.drawText(footerText, {
    x: (PAGE_WIDTH - footerWidth) / 2,
    y: footerY,
    size: 10,
    font: fonts.helvetica,
    color: COLORS.burgundy
  });
  
  const footerSub = 'WSET-Certified Sommelier Consultation';
  const footerSubWidth = fonts.helvetica.widthOfTextAtSize(footerSub, 8);
  page.drawText(footerSub, {
    x: (PAGE_WIDTH - footerSubWidth) / 2,
    y: footerY - 15,
    size: 8,
    font: fonts.helvetica,
    color: COLORS.textLight
  });
  
  const footerEmail = 'Questions? hello@cellarsense.ai';
  const footerEmailWidth = fonts.helvetica.widthOfTextAtSize(footerEmail, 8);
  page.drawText(footerEmail, {
    x: (PAGE_WIDTH - footerEmailWidth) / 2,
    y: footerY - 28,
    size: 8,
    font: fonts.helvetica,
    color: COLORS.textMedium
  });
  
  // Page number
  page.drawText('8', {
    x: PAGE_WIDTH / 2 - 5,
    y: 40,
    size: 10,
    font: fonts.helvetica,
    color: COLORS.textLight
  });
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function wrapText(text, font, size, maxWidth) {
  if (!text) return [];
  
  // Replace newlines with spaces and clean up
  const cleanText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  
  const words = cleanText.split(' ');
  const lines = [];
  let currentLine = '';
  
  words.forEach(word => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, size);
    
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  });
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines;
}

function getBarTypeLabel(barType) {
  const labels = {
    'wine-focus': 'Wine-Focused',
    'mixed': 'Mixed Bar',
    'wine-beer': 'Wine & Beer',
    'toast-only': 'Toast Only'
  };
  return labels[barType] || 'Mixed Bar';
}
