+++
title = "Structured output"
+++
Most agent frameworks produce text. When code needs the answer, they ask the
model for JSON matching a schema, parse it, and validate the result. The value is
untyped for the whole middle of that journey, and a response that does not
validate costs another round trip:

![A model produces text. The text is JSON whose shape is not guaranteed. The application parses and validates it, which may fail and force another request to the model. Only after that does the value reach application code as a typed value.](/img/structured-output-json.svg)

Harpe usually does not need that round trip. The model emits something already
typed, and the type is checked before anything runs. There are two routes, and an
agent commonly uses both in the same turn:

![A model turn produces structure by one of two routes. It writes a Jo program, whose types the compiler checks before it reaches a capability such as an API, database, or file. Or it emits a message together with a typed tool call, whose arguments the tool declaration checks, and the driver reads that call from the transcript and renders it as an attachment on the reply.](/img/structured-output-routes.svg)

Both share one property. The structured value never becomes text that the
application has to parse back.

## Route 1: keep data inside the program

Suppose an agent classifies a request, builds a report, or prepares an API
payload. Its Jo program can construct the value, branch on it, transform it, and
pass it to a capability:

```jo
union Severity = Low | Normal | High

val ticket = new Ticket(
  severity = High,
  component = "billing",
  summary = "Invoice totals disagree with the ledger"
)

if ticket.severity is High then api.page(oncall, ticket)

api.createTicket(ticket)
```

The compiler checks those operations before the program runs. `High` is a value
of a real type, not the string `"high"` that a parser hopes to recognize. A
misspelled field, a severity that is not in the union, or an argument in the
wrong position fails to compile, so it never reaches `createTicket`.

The destination is normally the capability that needs the data:

- call an API.
- update a database.
- create a ticket.
- write an artifact.
- trigger another system.

There is no benefit in first serializing that value as the agent's final answer,
only for host code to parse it and send it to the same destination.

## Route 2: the tool call is the record

Sometimes the structured output is not data for a capability. It is an
instruction to the **application** about how to present the turn. A program
cannot do that, because the application, not the sandbox, owns presentation.

The tool call itself carries the structure. The web agent delivers files this
way, with a tool that moves no bytes at all:

```jo
section SendFileTool
  private def spec: Tool =
    Tool:
      "sendFile"
      "Deliver a file to the user — it appears as an attachment in your reply."
      [Tool.strParam("fileName", "The name of the file in your data directory to send")]

  def send(fileName: String, dir: String): Tool.RunOutcome =
    val baseName = os.path.basename(fileName)

    if !os.path.isfile(os.path.join(dir, baseName)) then
      new Tool.RunOutcome:
        "No such file: '\{fileName}'. Write it to your data directory first, then send it."
        "sendFile · no such file"
        attachments = []
        success = false

    else
      new Tool.RunOutcome:
        "Sent '\{baseName}' to the user."
        "sendFile · \{baseName}"
        attachments = []
end
```

The route validates the name and returns prose for the model. The *delivery* is
not something the handler does. `Agent.ask` hands back the finished turn, and the
driver reads its own output out of it — the calls the agent made are the record:

```jo
//[ What the agent said and sent this turn, in the order it happened. //]
def reply(turn: TurnData): Value =
  // A `sendFile` the tool refused is not a delivery. Collect the refused call
  // ids first: the results arrive after the message that made the calls.
  var refused = Set.empty[String]
  for m in turn.messages do
    if m is ToolResults(results) then
      for r in results if !r.success do refused = refused + r.id

  var parts: List[Value] = []

  for m in turn.messages do
    if m is Assistant(text, calls) then
      var files: List[Value] = []
      for c in calls if c.name == "sendFile" && !refused.contains(c.id) do
        files = files + c.input.string("fileName")

      if text.trim != "" || !files.isEmpty then
        parts = parts + Journal.payload("text" ~ text.trim, "files" ~ files)

  parts
```

One entry per assistant message, so a file stays with the words it arrived with.

A refusal is where the two audiences separate. The model is told in prose why
nothing was sent, and reads that as its next turn's input. The driver reads
[`success`](/concepts/tools/) off the `ToolResult` instead, so the call it made
never becomes an attachment on the page. Both come off the same record, which is
what keeps them from disagreeing.

That value closes the turn's transcript bracket, beside the driver's own record
of what the user asked:

```jo
transcript.turn: request, () =>
  val turn = Agent.ask(prompt, brain = brain, tools = tools, transcript = transcript)
  Journal.payload("reply" ~ Session.reply(turn))
```

One event, two renderings. The model sees a tool call it made and knows what it
sent. The user sees an attachment on the message, rendered from the record —
live, or rebuilt from disk a week later. Neither view is derived from parsing the
assistant's prose, so they cannot disagree.

This is why the parameters matter as much as the handler. `params` is the schema,
each provider renders its own wire format from it, and the model's arguments
arrive typed. A malformed call is rejected before your code sees it, and a call
that is well-formed but wrong — a file that does not exist — comes back as a
readable error the model can act on:

```jo
new Tool.RunOutcome:
  "No such file: '\{fileName}'. Write it to your data directory first, then send it."
  "sendFile · no such file"
  attachments = []
```

## Choosing a route

| | Route 1: program | Route 2: tool call |
|---|---|---|
| The value goes to | a capability | the application |
| Checked by | the compiler | the tool's `params` |
| Good for | payloads, records, computation | presentation, delivery, UI intent |
| The model can | branch, loop, transform | state one intent per call |

Route 1 suits a value the agent *computes* and hands onward. Route 2 suits a
decision the agent *declares* about the turn itself. Reach for route 2 when the
generated program has no business knowing the answer, as with which files the
user should see.

## Messages are for people

An agent can finish with text and use either route alongside it. These are
complementary outputs. The message explains the result to the user, and the
program or tool call performs the typed work.

Harpe therefore does not require every turn to fit one structured response
object. A useful answer may naturally be several messages, an attachment, and an
API call.
