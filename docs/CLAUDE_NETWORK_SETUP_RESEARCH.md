# Claude network setup: frontend inspection

Inspected 17 November 2026. Scope: prepopulate the relay hostname in the existing personal-account **Capabilities → Allowed websites → Add a website** field through a link, leaving the user to confirm Add. This is not chat prompt prefill, an MCP connector, browser-extension site permissions or organization provisioning.

## Result

The inspected Claude web build supports navigation to the Allowed websites page and a parameter that targets the network-access section. Its personal-account domain input does not implement a URL-prefill path. The existing AgentRoom shortcut therefore opens the real settings page and copies the hostname; it must not be described as automatic prefill or a single confirmation flow.

This is a conclusion about the inspected build and components, not a guarantee about every historical, future, gated or native Claude build. No account settings were changed during this inspection. The previously approved single relay-domain entry and Standard download sites only policy remained present.

## Primary frontend evidence

The browser's script/preload elements identified the actual public asset origin and build entry. Public JavaScript was downloaded for static inspection without account cookies or credentials. No downloaded application code was executed outside its normal browser page.

- [Current build entry](https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/index-9hWEygA_.js).
- [Capabilities component](https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/c71860c77-DbKVcG8H.js), SHA-256 `cbddb1df079e304947369797b7a31448eebaead8ac018c96f52d7cf8e74e69be`.
- [Settings URL/action parser](https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/shared-m-1-8mw6JzMT.js), SHA-256 `c2f5c34464936d4bd8e0da318e8d98e8434a82cbfcadbd0e0025d67529a39ca9`.
- [Account-setting selectors](https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/shared-m-4-BqHOo8Ss.js).
- [Organization capabilities component](https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/cd2f1914c-CBnntg5F.js), inspected separately to avoid confusing account and organization settings.

### Domain input data flow

In the capabilities bundle, function `jr` selects the Allowed websites details view for the `allowed-websites` frame. Function `yn` passes enabled state, saved allowed hosts, the current host template, save callback and pending state into function `fn`. It passes no proposed domain, initial input value or URL-derived setting.

Function `fn` occupies character offsets 7114–11704 in the downloaded UTF-8-as-text source. It initializes the controlled domain input with an empty string. The input's value comes from that local state. Its setter has exactly two call sites: the input change handler and clearing the input after Add. There is no URL, query, fragment, pending-action or prefill read in this function. Its auxiliary hooks handle added-row tracking and blur/pointer timing; neither initializes the input from a link.

Saved domains come from the account's `wiggle_egress_allowed_hosts` setting. Add validates the typed hostname, constructs a saved-host list plus an additive delta and invokes the account-setting mutation. Those stored-setting property names are not URL parameters. The separately inspected organization input also starts with empty local input state.

### URL actions

The settings parser maps recognized parameter/value pairs to pending UI actions. The capabilities action table includes `highlight=network_access`, implemented as `highlight-network-access`, targeting `allow-network-egress`. Other entries cover memory import and highlights for other settings. No domain-prefill action is present in that table. Unrecognized settings parameters are not automatically assigned to arbitrary component fields.

Confirmed destinations:

- `https://claude.ai/new#settings/capabilities/allowed-websites`: opens Allowed websites directly in the inspected signed-in account.
- `https://claude.ai/settings/capabilities?highlight=network_access`: accepted as a capabilities action; the live UI normalized to the capabilities settings frame. Following Manage opens the same Allowed websites view. This does not fill the hostname input.

The browser showed the saved narrow relay-domain entry, an empty Add a website input and a disabled Add button. No domain was added/removed and no network mode was changed.

## GitHub search

Searched GitHub code for the exact settings path, the allowed-websites label with claude.ai, and network-egress/query/prefill combinations. No implementation or working domain-prefill link for this personal-account setting was found. Search absence alone is not the basis for the conclusion; the concrete component data flow above is.

[Anthropic issue #107314](https://github.com/anthropics/claude-code/issues/107314) documents discoverability of this exact setting and its dependence on internet access being enabled. It does not establish a domain-prefill parameter. Connector-name/server-URL parameters belong to a different form and were excluded from the solution.

## Product status

No further runtime change was made from this investigation. AgentRoom retains the explicit settings-navigation/hostname-copy shortcut, browser client, direct CLI, encryption boundary and existing rooms. Achieving actual native domain prefill through a normal link would require a URL-consuming entry point in Claude that is absent from the inspected component/parser, or evidence of a different supported flow. Do not manufacture a parameter or claim an end-to-end success from navigation alone.

Raw public bundles, formatted inspection copies and a screenshot are local, ignored research material under `.wrangler/claude-ui-research/`. They contain no copied account credentials. They are not vendored into the application or this repository's tracked source.
