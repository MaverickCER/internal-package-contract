/** Content under test is deliberately loose: each test reaches into it and breaks one field. */
export type Loose = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- fixtures are deliberately loose

/** A complete, valid site content object for tests; clone before changing. */
export function validSite() {
  return {
    siteUrl: "https://example.github.io/demo-pkg/",
    repoUrl: "https://github.com/example/demo-pkg",
    title: "demo-pkg: one clear idea",
    description: "Demo package that does one thing well.",
    maturity: "demo-pkg is pre-1.0. A 0.x minor may carry a breaking change; pin accordingly.",
    hero: {
      eyebrow: "A short category",
      heading: "Do the thing once, everywhere.",
      lede: "Your tools check the code. They do not say what counts as acceptable.",
      support: "demo-pkg defines that, once, and applies it everywhere.",
      outcome:
        "Give every repository one versioned standard without forcing any team to change its tools.",
    },
    install: {
      label: "Quick start",
      commands: ["npm install --save-dev demo-pkg", "npx demo-pkg init"],
      note: "Install only the tools you already use.",
    },
    cta: {
      primary: { label: "Read the README", url: "https://github.com/example/demo-pkg#readme" },
      secondary: {
        label: "Run the examples",
        url: "https://github.com/example/demo-pkg/tree/main/examples",
      },
    },
    problem: {
      eyebrow: "Why it exists",
      heading: "The standard is scattered.",
      lede: "Rules live in many places.",
      listLabel: "Where the rules live today",
      items: ["CI files", "scripts"],
      conclusion: "no single place answers what is acceptable",
      closing: "Individual tools answer individual questions.",
    },
    model: {
      eyebrow: "How it works",
      heading: "Tools produce results. You decide what they mean.",
      lede: "A **check** runs a command. A **policy** decides.",
      flow: ["Your tools", "demo-pkg", "Evidence → Policy → Verdict"],
      flowDescription: "Tools feed demo-pkg, which produces one verdict.",
      note: "Policies run only after every check has finished.",
    },
    guarantees: {
      eyebrow: "Guarantees",
      heading: "What is guaranteed, and what is not.",
      lede: "Each claim names its scope.",
      items: [
        {
          claim: "No network calls in the shipped code.",
          scope: "Covers this package's own code; it does not cover commands you configure.",
          linkLabel: "Read the security model",
          url: "https://github.com/example/demo-pkg/blob/main/SECURITY.md",
        },
      ],
    },
    comparison: {
      eyebrow: "Why not just CI",
      heading: "CI runs checks. This defines acceptable.",
      lede: "Keep your CI.",
      caption: "Where common approaches stop",
      columns: ["Today", "With demo-pkg"],
      rows: [["Rules scattered", "One contract"]],
    },
    demo: {
      eyebrow: "See it",
      heading: "Real output.",
      intro:
        "The output of the example in [examples/demo](https://github.com/example/demo-pkg/tree/main/examples/demo):",
      command: "npm run demo",
      output: "[PASS] typecheck\n  ok",
      source: {
        label: "examples/demo",
        url: "https://github.com/example/demo-pkg/tree/main/examples/demo",
      },
      explanation: "Every line says what happened.",
    },
    adoption: {
      eyebrow: "Adoption",
      heading: "Start with one check.",
      lede: "It is incremental.",
      calloutTitle: "A progressive rollout, not a migration",
      steps: ["Wrap one check.", "Write its policy."],
      notFor: {
        title: "You probably do not need it when",
        text: "Your project is small and one team owns every rule.",
      },
    },
    resources: {
      eyebrow: "Proof",
      heading: "Uses itself.",
      lede: "The evidence is public.",
      items: [
        {
          title: "Architecture",
          description: "The pipeline.",
          label: "Read architecture.md",
          url: "https://github.com/example/demo-pkg/blob/main/specs/architecture.md",
        },
        {
          title: "API reference",
          description: "Every type.",
          label: "Read the API reference",
          url: "api/",
        },
      ],
    },
    brief: {
      heading: "A one-page brief for your manager",
      oneLine: "demo-pkg lets every repository follow one shared engineering standard.",
      problem:
        "Teams keep their quality rules in many different places, so nobody can say what acceptable means.",
      whatItDoes:
        "It runs the tools a team already uses and applies one agreed standard to their results.",
      whyItMatters: [
        "Every team is held to the same bar.",
        "A new rule can be introduced gradually.",
      ],
      whatItCosts:
        "Adopting it takes a few hours per repository and replaces none of the existing tools.",
      whatCouldGoWrong: ["It is pre-1.0, so a minor release may change behaviour."],
      whatWeAsk: "Agree that one repository trials it for two weeks.",
    },
    fit: { eyebrow: "Next", heading: "See whether it fits.", lede: "Read the README first." },
    footer: {
      links: [{ label: "Issues", url: "https://github.com/example/demo-pkg/issues" }],
      license: {
        label: "MIT License",
        url: "https://github.com/example/demo-pkg/blob/main/LICENSE",
      },
      copyright: "demo-pkg contributors",
    },
  }
}
