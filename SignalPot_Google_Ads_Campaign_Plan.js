const fs = require("fs");
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
        BorderStyle, WidthType, ShadingType, PageNumber, PageBreak,
        ExternalHyperlink, TabStopType, TabStopPosition } = require("docx");

const ACCENT = "1A73E8"; // Google blue
const DARK = "202124";
const GRAY = "5F6368";
const LIGHT_BG = "E8F0FE";
const WHITE = "FFFFFF";

const border = { style: BorderStyle.SINGLE, size: 1, color: "DADCE0" };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0 };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function headerCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: ACCENT, type: ShadingType.CLEAR },
    margins: cellMargins,
    verticalAlign: "center",
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: WHITE, font: "Arial", size: 20 })] })]
  });
}

function dataCell(text, width, opts = {}) {
  const shading = opts.shaded ? { fill: "F8F9FA", type: ShadingType.CLEAR } : { fill: WHITE, type: ShadingType.CLEAR };
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading,
    margins: cellMargins,
    children: [new Paragraph({
      children: [new TextRun({ text, font: "Arial", size: 20, color: DARK, bold: opts.bold || false })]
    })]
  });
}

function dataCellRuns(runs, width, opts = {}) {
  const shading = opts.shaded ? { fill: "F8F9FA", type: ShadingType.CLEAR } : { fill: WHITE, type: ShadingType.CLEAR };
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading,
    margins: cellMargins,
    children: [new Paragraph({ children: runs })]
  });
}

// Numbering config
const numbering = {
  config: [
    {
      reference: "bullets",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } }
      }]
    },
    {
      reference: "steps",
      levels: [{
        level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } }
      }]
    },
    {
      reference: "bullets2",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } }
      }]
    },
    {
      reference: "bullets3",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } }
      }]
    },
    {
      reference: "steps2",
      levels: [{
        level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } }
      }]
    },
  ]
};

// ── Helper: section heading with accent bar ──
function sectionHeading(text) {
  return [
    new Paragraph({ children: [] }), // spacer
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 4 } },
      spacing: { after: 200 },
      children: [new TextRun({ text, font: "Arial", size: 32, bold: true, color: ACCENT })]
    }),
  ];
}

function subHeading(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text, font: "Arial", size: 26, bold: true, color: DARK })]
  });
}

function bodyText(text) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, font: "Arial", size: 22, color: DARK })]
  });
}

function bulletItem(text, ref = "bullets") {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: "Arial", size: 22, color: DARK })]
  });
}

function stepItem(text, ref = "steps") {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, font: "Arial", size: 22, color: DARK })]
  });
}

// ── Build the document ──
const doc = new Document({
  numbering,
  styles: {
    default: { document: { run: { font: "Arial", size: 22, color: DARK } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: ACCENT },
        paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: DARK },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 } },
    ]
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: ACCENT, space: 4 } },
            children: [
              new TextRun({ text: "SignalPot.dev  ", font: "Arial", size: 18, bold: true, color: ACCENT }),
              new TextRun({ text: "|  Google Ads Campaign Plan", font: "Arial", size: 18, color: GRAY }),
            ]
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: "Page ", font: "Arial", size: 16, color: GRAY }),
              new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: GRAY }),
            ]
          })]
        })
      },
      children: [
        // ── TITLE BLOCK ──
        new Paragraph({ spacing: { after: 0 }, children: [] }),
        new Paragraph({ spacing: { after: 0 }, children: [] }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: "GOOGLE ADS CAMPAIGN PLAN", font: "Arial", size: 44, bold: true, color: ACCENT })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [new TextRun({ text: "SignalPot.dev", font: "Arial", size: 32, color: DARK })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: "Agent-to-Agent Platform for Building AI Agents", font: "Arial", size: 24, color: GRAY })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [new TextRun({ text: "Prepared: March 25, 2026", font: "Arial", size: 20, color: GRAY })]
        }),

        // ── CAMPAIGN OVERVIEW ──
        ...sectionHeading("1. Campaign Overview"),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [3120, 6240],
          rows: [
            new TableRow({ children: [headerCell("Setting", 3120), headerCell("Value", 6240)] }),
            new TableRow({ children: [dataCell("Campaign Name", 3120, { bold: true }), dataCell("SignalPot \u2013 Search \u2013 Agent Builders", 6240)] }),
            new TableRow({ children: [dataCell("Campaign Type", 3120, { bold: true, shaded: true }), dataCell("Search (Text Ads)", 6240, { shaded: true })] }),
            new TableRow({ children: [dataCell("Goal", 3120, { bold: true }), dataCell("Website Traffic / Sign-ups", 6240)] }),
            new TableRow({ children: [dataCell("Monthly Budget", 3120, { bold: true, shaded: true }), dataCell("$5.00/month (~$0.16/day)", 6240, { shaded: true })] }),
            new TableRow({ children: [dataCell("Bidding Strategy", 3120, { bold: true }), dataCell("Maximize Clicks (recommended for micro-budgets)", 6240)] }),
            new TableRow({ children: [dataCell("Networks", 3120, { bold: true, shaded: true }), dataCell("Google Search only (disable Display & Search Partners)", 6240, { shaded: true })] }),
            new TableRow({ children: [dataCell("Location", 3120, { bold: true }), dataCell("United States (or adjust to target market)", 6240)] }),
            new TableRow({ children: [dataCell("Language", 3120, { bold: true, shaded: true }), dataCell("English", 6240, { shaded: true })] }),
            new TableRow({ children: [dataCell("Landing Page", 3120, { bold: true }), dataCell("https://signalpot.dev", 6240)] }),
          ]
        }),

        // ── BUDGET NOTES ──
        ...sectionHeading("2. Budget Strategy & Expectations"),
        bodyText("With a $5/month budget, your campaign will be extremely targeted. Here\u2019s what to expect:"),
        bulletItem("Google\u2019s minimum daily budget is typically $1/day. You may need to set $1/day and pause after 5 days each month, or set a monthly budget cap of $5."),
        bulletItem("At an estimated CPC of $1\u20133 for AI/developer keywords, expect 2\u20135 clicks per month."),
        bulletItem("Focus on long-tail, low-competition keywords to maximize value per click."),
        bulletItem("Consider this a testing phase \u2014 use data to identify which keywords convert, then scale budget for winners."),
        bodyText("Tip: In Google Ads, set your campaign to \u201CManual CPC\u201D with a max bid of $1.50 to control costs tightly."),

        // ── AD GROUP & KEYWORDS ──
        ...sectionHeading("3. Ad Groups & Keywords"),
        subHeading("Ad Group 1: Agent Builder Platform"),
        bodyText("This is your primary ad group targeting developers looking to build AI agents."),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [4680, 2340, 2340],
          rows: [
            new TableRow({ children: [headerCell("Keyword", 4680), headerCell("Match Type", 2340), headerCell("Est. CPC", 2340)] }),
            new TableRow({ children: [dataCell("build ai agents", 4680), dataCell("Phrase", 2340), dataCell("$1.20\u2013$2.50", 2340)] }),
            new TableRow({ children: [dataCell("ai agent builder platform", 4680, { shaded: true }), dataCell("Phrase", 2340, { shaded: true }), dataCell("$0.80\u2013$1.80", 2340, { shaded: true })] }),
            new TableRow({ children: [dataCell("agent to agent platform", 4680), dataCell("Exact", 2340), dataCell("$0.50\u2013$1.00", 2340)] }),
            new TableRow({ children: [dataCell("multi agent framework", 4680, { shaded: true }), dataCell("Phrase", 2340, { shaded: true }), dataCell("$1.00\u2013$2.00", 2340, { shaded: true })] }),
            new TableRow({ children: [dataCell("create autonomous agents", 4680), dataCell("Phrase", 2340), dataCell("$0.80\u2013$1.50", 2340)] }),
            new TableRow({ children: [dataCell("agent orchestration tool", 4680, { shaded: true }), dataCell("Phrase", 2340, { shaded: true }), dataCell("$0.60\u2013$1.20", 2340, { shaded: true })] }),
          ]
        }),
        new Paragraph({ spacing: { after: 120 }, children: [] }),
        subHeading("Ad Group 2: Agent Development Tools"),
        bodyText("Secondary group capturing developers researching agent development."),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [4680, 2340, 2340],
          rows: [
            new TableRow({ children: [headerCell("Keyword", 4680), headerCell("Match Type", 2340), headerCell("Est. CPC", 2340)] }),
            new TableRow({ children: [dataCell("ai agent development tools", 4680), dataCell("Phrase", 2340), dataCell("$1.00\u2013$2.20", 2340)] }),
            new TableRow({ children: [dataCell("agent communication protocol", 4680, { shaded: true }), dataCell("Phrase", 2340, { shaded: true }), dataCell("$0.40\u2013$0.90", 2340, { shaded: true })] }),
            new TableRow({ children: [dataCell("deploy ai agents", 4680), dataCell("Phrase", 2340), dataCell("$0.90\u2013$1.80", 2340)] }),
            new TableRow({ children: [dataCell("agent workflow automation", 4680, { shaded: true }), dataCell("Phrase", 2340, { shaded: true }), dataCell("$0.70\u2013$1.50", 2340, { shaded: true })] }),
          ]
        }),

        // ── NEGATIVE KEYWORDS ──
        new Paragraph({ spacing: { after: 120 }, children: [] }),
        subHeading("Negative Keywords (Add These!)"),
        bodyText("Prevent wasted spend on irrelevant clicks:"),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [4680, 4680],
          rows: [
            new TableRow({ children: [headerCell("Negative Keyword", 4680), headerCell("Reason", 4680)] }),
            new TableRow({ children: [dataCell("real estate agent", 4680), dataCell("Wrong type of agent", 4680)] }),
            new TableRow({ children: [dataCell("travel agent", 4680, { shaded: true }), dataCell("Wrong type of agent", 4680, { shaded: true })] }),
            new TableRow({ children: [dataCell("insurance agent", 4680), dataCell("Wrong type of agent", 4680)] }),
            new TableRow({ children: [dataCell("free", 4680, { shaded: true }), dataCell("Low-intent traffic", 4680, { shaded: true })] }),
            new TableRow({ children: [dataCell("tutorial", 4680), dataCell("Informational, not buyer intent", 4680)] }),
            new TableRow({ children: [dataCell("what is", 4680, { shaded: true }), dataCell("Informational queries", 4680, { shaded: true })] }),
            new TableRow({ children: [dataCell("jobs", 4680), dataCell("Job seekers, not customers", 4680)] }),
            new TableRow({ children: [dataCell("salary", 4680, { shaded: true }), dataCell("Job seekers, not customers", 4680, { shaded: true })] }),
          ]
        }),

        // ── AD COPY ──
        new Paragraph({ children: [new PageBreak()] }),
        ...sectionHeading("4. Ad Copy (Responsive Search Ads)"),
        bodyText("Google Ads requires up to 15 headlines (30 chars each) and 4 descriptions (90 chars each). Google\u2019s AI will test combinations. Here are optimized options:"),
        new Paragraph({ spacing: { after: 120 }, children: [] }),
        subHeading("Headlines (30 character limit)"),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [780, 5460, 3120],
          rows: [
            new TableRow({ children: [headerCell("#", 780), headerCell("Headline", 5460), headerCell("Characters", 3120)] }),
            new TableRow({ children: [dataCell("1", 780), dataCell("Build AI Agents Fast", 5460), dataCell("20", 3120)] }),
            new TableRow({ children: [dataCell("2", 780, { shaded: true }), dataCell("Agent-to-Agent Platform", 5460, { shaded: true }), dataCell("23", 3120, { shaded: true })] }),
            new TableRow({ children: [dataCell("3", 780), dataCell("Ship Agents in Minutes", 5460), dataCell("22", 3120)] }),
            new TableRow({ children: [dataCell("4", 780, { shaded: true }), dataCell("SignalPot | Agent Builder", 5460, { shaded: true }), dataCell("25", 3120, { shaded: true })] }),
            new TableRow({ children: [dataCell("5", 780), dataCell("Multi-Agent Orchestration", 5460), dataCell("25", 3120)] }),
            new TableRow({ children: [dataCell("6", 780, { shaded: true }), dataCell("Connect Your AI Agents", 5460, { shaded: true }), dataCell("22", 3120, { shaded: true })] }),
            new TableRow({ children: [dataCell("7", 780), dataCell("Agent Dev Made Simple", 5460), dataCell("22", 3120)] }),
            new TableRow({ children: [dataCell("8", 780, { shaded: true }), dataCell("Deploy Agents Today", 5460, { shaded: true }), dataCell("19", 3120, { shaded: true })] }),
            new TableRow({ children: [dataCell("9", 780), dataCell("The Agent Builder Platform", 5460), dataCell("26", 3120)] }),
            new TableRow({ children: [dataCell("10", 780, { shaded: true }), dataCell("Try SignalPot Free", 5460, { shaded: true }), dataCell("18", 3120, { shaded: true })] }),
          ]
        }),

        new Paragraph({ spacing: { after: 200 }, children: [] }),
        subHeading("Descriptions (90 character limit)"),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [780, 6240, 2340],
          rows: [
            new TableRow({ children: [headerCell("#", 780), headerCell("Description", 6240), headerCell("Characters", 2340)] }),
            new TableRow({ children: [dataCell("1", 780), dataCell("Build, connect, and deploy AI agents with SignalPot. The agent-to-agent platform.", 6240), dataCell("81", 2340)] }),
            new TableRow({ children: [dataCell("2", 780, { shaded: true }), dataCell("Create powerful multi-agent systems. SignalPot makes agent orchestration simple.", 6240, { shaded: true }), dataCell("80", 2340, { shaded: true })] }),
            new TableRow({ children: [dataCell("3", 780), dataCell("Stop building agents from scratch. SignalPot gives you the tools to ship faster.", 6240), dataCell("81", 2340)] }),
            new TableRow({ children: [dataCell("4", 780, { shaded: true }), dataCell("Developer-first agent platform. Build autonomous agents that work together.", 6240, { shaded: true }), dataCell("74", 2340, { shaded: true })] }),
          ]
        }),

        // ── AD EXTENSIONS ──
        ...sectionHeading("5. Ad Extensions (Assets)"),
        bodyText("Extensions increase ad real estate and click-through rates at no extra cost. Add these:"),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2340, 3510, 3510],
          rows: [
            new TableRow({ children: [headerCell("Extension Type", 2340), headerCell("Text / Link", 3510), headerCell("Details", 3510)] }),
            new TableRow({ children: [dataCell("Sitelink 1", 2340), dataCell("Documentation", 3510), dataCell("signalpot.dev/docs", 3510)] }),
            new TableRow({ children: [dataCell("Sitelink 2", 2340, { shaded: true }), dataCell("Getting Started", 3510, { shaded: true }), dataCell("signalpot.dev/start", 3510, { shaded: true })] }),
            new TableRow({ children: [dataCell("Sitelink 3", 2340), dataCell("Pricing", 3510), dataCell("signalpot.dev/pricing", 3510)] }),
            new TableRow({ children: [dataCell("Callout 1", 2340, { shaded: true }), dataCell("Free to Start", 3510, { shaded: true }), dataCell("\u2014", 3510, { shaded: true })] }),
            new TableRow({ children: [dataCell("Callout 2", 2340), dataCell("Developer-First", 3510), dataCell("\u2014", 3510)] }),
            new TableRow({ children: [dataCell("Callout 3", 2340, { shaded: true }), dataCell("Agent-to-Agent", 3510, { shaded: true }), dataCell("\u2014", 3510, { shaded: true })] }),
            new TableRow({ children: [dataCell("Structured Snippet", 2340), dataCell("Types: Agent Builder, Orchestration, Deployment", 3510), dataCell("\u2014", 3510)] }),
          ]
        }),

        // ── SETUP WALKTHROUGH ──
        new Paragraph({ children: [new PageBreak()] }),
        ...sectionHeading("6. Step-by-Step Setup in Google Ads"),
        bodyText("Follow these steps to create your campaign at ads.google.com:"),
        new Paragraph({ spacing: { after: 80 }, children: [] }),
        subHeading("Phase 1: Create the Campaign"),
        stepItem("Go to ads.google.com and sign in to your account."),
        stepItem("Click the blue \u201C+ New Campaign\u201D button."),
        stepItem("Select goal: \u201CWebsite traffic\u201D (or \u201CCreate a campaign without a goal\u2019s guidance\u201D for more control)."),
        stepItem("Select campaign type: \u201CSearch\u201D."),
        stepItem("Enter your website: signalpot.dev. Click Continue."),
        stepItem("Name your campaign: \u201CSignalPot \u2013 Search \u2013 Agent Builders\u201D."),
        new Paragraph({ spacing: { after: 120 }, children: [] }),

        subHeading("Phase 2: Budget & Bidding"),
        stepItem("Set daily budget to $1.00 (minimum Google allows). You\u2019ll pause after ~5 days to stay within $5/month.", "steps2"),
        stepItem("Bidding: Select \u201CMaximize clicks\u201D. Set max CPC bid limit to $1.50.", "steps2"),
        stepItem("Uncheck \u201CGoogle Search Partners\u201D and \u201CGoogle Display Network\u201D.", "steps2"),
        new Paragraph({ spacing: { after: 120 }, children: [] }),

        subHeading("Phase 3: Targeting"),
        stepItem("Locations: Select \u201CUnited States\u201D (or your target market)."),
        stepItem("Languages: English."),
        stepItem("Audience segments: Skip for now (let keywords do the targeting)."),
        new Paragraph({ spacing: { after: 120 }, children: [] }),

        subHeading("Phase 4: Ad Groups & Keywords"),
        stepItem("Create Ad Group 1: Name it \u201CAgent Builder Platform\u201D.", "steps2"),
        stepItem("Add the keywords from Section 3 above. Use the match types specified (phrase match uses quotes, exact match uses brackets).", "steps2"),
        stepItem("Create Ad Group 2: Name it \u201CAgent Development Tools\u201D and add its keywords.", "steps2"),
        stepItem("Add negative keywords from Section 3 at the campaign level.", "steps2"),
        new Paragraph({ spacing: { after: 120 }, children: [] }),

        subHeading("Phase 5: Write Your Ads"),
        stepItem("For each ad group, create a Responsive Search Ad."),
        stepItem("Enter the headlines and descriptions from Section 4."),
        stepItem("Set Final URL to: https://signalpot.dev"),
        stepItem("Add the ad extensions from Section 5."),
        stepItem("Review and publish!"),

        // ── OPTIMIZATION TIPS ──
        ...sectionHeading("7. Optimization Tips for Micro-Budgets"),
        bulletItem("Schedule ads during business hours only (9 AM\u20136 PM) when developers are active. This stretches your budget.", "bullets2"),
        bulletItem("Review Search Terms Report weekly. Add irrelevant terms as negatives immediately.", "bullets2"),
        bulletItem("Pause low-performing keywords after 10+ impressions with 0 clicks.", "bullets2"),
        bulletItem("Test different landing pages if CTR is below 3%.", "bullets2"),
        bulletItem("Consider increasing budget to $20\u201330/month once you identify winning keywords.", "bullets2"),
        bulletItem("Enable conversion tracking (sign-ups, demo requests) to measure ROI.", "bullets2"),

        // ── KPIs ──
        ...sectionHeading("8. Key Metrics to Track"),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2340, 3510, 3510],
          rows: [
            new TableRow({ children: [headerCell("Metric", 2340), headerCell("Target", 3510), headerCell("Why It Matters", 3510)] }),
            new TableRow({ children: [dataCell("CTR", 2340), dataCell("Above 3%", 3510), dataCell("Shows ad relevance to keywords", 3510)] }),
            new TableRow({ children: [dataCell("CPC", 2340, { shaded: true }), dataCell("Under $1.50", 3510, { shaded: true }), dataCell("Controls spend per visitor", 3510, { shaded: true })] }),
            new TableRow({ children: [dataCell("Quality Score", 2340), dataCell("7+/10", 3510), dataCell("Lowers CPC and improves position", 3510)] }),
            new TableRow({ children: [dataCell("Impressions", 2340, { shaded: true }), dataCell("Track trend", 3510, { shaded: true }), dataCell("Are your keywords getting searched?", 3510, { shaded: true })] }),
            new TableRow({ children: [dataCell("Conversions", 2340), dataCell("Set up tracking", 3510), dataCell("Actual sign-ups from ad clicks", 3510)] }),
          ]
        }),
      ]
    }
  ]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/sessions/determined-laughing-hamilton/mnt/signalpot/SignalPot_Google_Ads_Campaign_Plan.docx", buffer);
  console.log("Document created successfully!");
});
