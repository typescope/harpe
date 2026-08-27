+++
title = "Skills"
+++
Skills are optional instructions and reference material that an agent can read
when a task needs them. A skill might explain how to write Jo, document a payment
API, or describe your organization's review process.

Harpe stores skills as text files in a directory chosen by the application. The
application adds read-only skill tools to the agent, which can then discover,
search, and read those files during a turn.

## Where skills fit

An agent receives guidance and authority from different places:

| Component | What it provides | When it is available |
| --- | --- | --- |
| `AGENT.md` | The agent's role and always-on instructions | In context from the start |
| Skills | Optional instructions and reference material | When the model chooses to read them |
| Tools | Operations implemented by the host application | When added to the turn's `Toolset` |
| Capabilities | Operations available to generated code | When granted by the sandbox API |

A skill can teach the model how or when to use an operation. It cannot grant that
operation. The application still decides which tools and capabilities the agent
may use.

## Progressive disclosure

Putting every reference in `AGENT.md` makes the model receive all of it on every
turn, whether it is relevant or not. Skills let the model load information in
stages:

1. The model knows that skill tools are available.
2. It lists or searches the available files when it needs more information.
3. It reads the relevant file.
4. The file content enters the conversation as a tool result and can guide the
   rest of the turn.

This is progressive disclosure. The agent begins with a small set of general
instructions and pulls in detailed guidance only when a task calls for it.

Reading a skill still uses model context. The benefit is that unrelated skills
stay out of the conversation. Keep individual files focused so the agent can
load one useful topic without loading a large manual.

## Organizing skills

A skill needs no manifest or registration. It is a UTF-8 text file under the
skills directory:

```text
skills/
  jo-cheat-sheet.md
  reviews/
    pull-requests.md
  api/
    payments.md
```

Subdirectories help group related material. The agent sees paths relative to the
skills directory, such as `api/payments.md`. Markdown is usually the clearest
format, but other text-file extensions work as well.

Useful skill content includes:

- task-specific procedures
- API and data-format documentation
- examples and templates
- terminology and domain rules
- review checklists

Keep the agent's identity and rules that must always apply in `AGENT.md`. Put
details needed only for particular tasks in skills.

## Adding skills to an agent

Choose the directory and add `SkillTools` to the tools the agent already has:

```jo
val skillsDir = os.path.join(appHome, "skills")

val tools =
  SkillTools.toolset(skillsDir)
    ++ runCode.toolset()

val turn =
  Agent.ask:
    message
    brain = brain
    tools = tools
    context = context
```

There is no default skills directory. Passing the path explicitly makes it clear
which references are available to this agent or session.

`SkillTools` contributes three model-facing tools:

- `skillsList` lists the available file names.
- `skillsSearch` searches for matching lines across the files.
- `skillsRead` returns the complete contents of one file.

A common flow is to search for a topic and then read the file containing the
relevant match. Search returns a bounded number of matching lines. Reading
returns the complete file, which is another reason to keep files focused.

## Telling the agent when to use skills

Adding the tools makes skills available, but the model still needs to understand
when they matter. Give it a short pointer in `AGENT.md`:

> Reference material is available through the skill tools. Before writing Jo,
> read `jo-cheat-sheet.md`. For payment tasks, consult `api/payments.md`.

Name important skills when the choice is predictable. When the collection is
larger or changes often, tell the agent to list or search it before beginning a
specialized task.

## Trust and boundaries

Skill content becomes input to the model. Treat it like other instructions and
reference material:

- Use content you trust to guide the agent.
- Do not store credentials or secrets in skill files.
- Remember that a skill cannot override the tools and capabilities selected by
  the application.

The provided skill tools are read-only. They confine paths to the configured
skills directory and reject attempts to escape it with an absolute path or
`..`. They do not let the agent create, modify, or delete skill files.
