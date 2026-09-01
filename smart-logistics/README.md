# Smart Logistics

A local web-based depot planner and a concrete demonstration of REST API surface
narrowing with Jo's capability model. Generated code can inspect logistics data
and create validated drafts, but it has no operation for approving or submitting
orders—and no raw database, filesystem, or network access.

## Run

```sh
pip install -r requirements.txt
cp .env.example .env
# add ANTHROPIC_API_KEY or OPENAI_API_KEY
jo start
```

Open <http://127.0.0.1:8766>. The first run creates `data/logistics.db` with demo
products, demand, rules, and suppliers. `ANALYSIS_INTERVAL_MINUTES=0` keeps the
scheduler off; set a positive value to enable periodic analysis.

The application has no login and is designed for a local administrator machine.
It refuses non-loopback binding unless `ALLOW_UNSAFE_REMOTE=true` is explicitly
set. That override is unsafe on an untrusted network.
