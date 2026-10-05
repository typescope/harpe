## Summary

<!-- What does this PR change, and why? Link the issue it fixes, if any. -->

## Checklist

- [ ] Docs: `docs/` updated if user-visible behavior changes
- [ ] Tests: added or updated under `tests/unit/` or `tests/integration/`, and `jo run test` passes
- [ ] Sign-off: every commit carries a `Signed-off-by` line ([why?](https://github.com/typescope/harpe/blob/main/CONTRIBUTING.md#contribution-terms))

<details>
<summary>How to sign off commits</summary>

`git commit -s` adds the `Signed-off-by` line.

To sign off the last commit retroactively:

```bash
git commit --amend -s --no-edit
```

To sign off the last three commits:

```bash
git rebase --signoff HEAD~3
```

</details>

## API compatibility

<!-- Harpe publishes `harpe` and `harpe-caps`, and the
templates pin published versions. Describe any change to what they expose. -->

- [ ] Source: existing agents and templates compile unchanged
- [ ] Behavior: existing agents behave the same, or the change is described above
- [ ] Log events: event names and fields are unchanged, or the change is described above
- [ ] `CHANGELOG.md` updated if a published API changed
