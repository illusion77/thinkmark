/**
 * Words accepted on top of the en-US dictionary: what people write in notes about software, which a
 * general dictionary does not know. All lower case, so `redis` and `Redis` both pass (ACRONYMS and
 * ProductNames are never checked anyway).
 *
 * `word+` also accepts the regular plural; `word/model` gets the inflections of the dictionary word `model`.
 */
export const EXTRA_WORDS = `
ok todo+ wifi bluetooth signup+ signin hostname+ localhost checkbox+ mindmap+ roadmap+ changelog+ readme+
webpage+ onboarding offboarding standup+ signoff+ handoff+ faq+ async roi kpi+ okr+ mvp+ poc+ qa ui ux shortener+

api+ sdk+ ide+ cli gui url+ uri+ uuid+ backend+ frontend+ fullstack config+ repo+ middleware+ namespace+
microservice+ webhook+ websocket+ enum+ struct+ mutex+ runtime+ bytecode dataframe+ schema+ serializer+
deserialize/serialize deserialization idempotency sharding failover+ rollout+ uptime scalable codebase+
linter+ cron crontab stdin stdout stderr unicode utf ascii hashmap+ checksum+ decrypt/encrypt memcached
devops dropdown+ tooltip+ navbar+ viewport+ breakpoint+ realtime serverless stateful monorepo+ polyfill+
transpile/compile minify/modify bundler+ lockfile+ symlink+ syscall+ bootloader+ param+ arg+ init impl
util+ lib+ src env+ dev stg func+ const str bool boolean+ num len idx tmp profiler+ allocator+ getter+
destructor+ validator+ tokenizer+ parser+ renderer+ resolver+ accessor+ initializer+ autocomplete
autoscaling autosave autofill inline+ unmount/mount rerender/render reindex/index preload/load
prefetch/fetch precompute/compute precompile/compile cacheable composable nullable iterable hashable
pluggable performant upsert+ dedupe dedup deduplicate/duplicate deduplication denormalize/serialize
denormalization templating debounce/bounce tokenize/serialize tokenization containerize/serialize
containerization virtualized orchestrator+ observability hotfix+ bugfix+ changeset+ regex+ subnet+
bitmask+ bitrate+ codec+ keyframe+ framerate+ backoff livelock+ failback multithreading multithreaded
multitenant multitenancy

sso oauth jwt+ auth authn authz acl+ rbac csrf xss cors tls ssl sftp tcp udp ip dns cdn+ http https html
css sql nosql json yaml toml xml csv tsv pdf svg png jpg jpeg gif webp grpc rpc graphql orm+ dto+ dao etl
elt olap oltp ttl lru lfu fifo lifo qps tps sla+ slo+ sli+ vm+ vpc+ vpn+ nat lan os cpu+ gpu+ ssd+ hdd+
io iot ai llm+ gpt nlp ocr saas paas iaas wasm

kubernetes redis kafka postgres postgresql mysql mariadb mongodb sqlite nginx apache linux unix macos
ubuntu debian centos github gitlab bitbucket npm pnpm webpack esbuild rollup vite eslint nodejs deno
javascript golang kotlin scala clojure haskell erlang php perl lua podman terraform ansible jenkins
grafana prometheus elasticsearch opensearch kibana logstash rabbitmq hadoop flink databricks redshift
bigquery dynamodb cassandra clickhouse etcd istio aws gcp cloudflare vercel netlify heroku firebase
supabase openai anthropic claude chatgpt gemini langchain pytorch tensorflow numpy jupyter matplotlib
vue nextjs jquery redux ios xcode vscode intellij neovim emacs tmux zsh powershell homebrew firefox
figma jira trello xmind thinkmark wikipedia youtube wechat alipay tiktok linkedin instagram whatsapp
reddit spotify netflix uber airbnb paypal shopify salesforce nvidia amd qualcomm samsung huawei xiaomi
alibaba tencent baidu bytedance microsoft facebook tesla webassembly webgl webrtc opentelemetry protobuf
avro lucene solr datadog pagerduty kubectl minikube dockerfile makefile cmake gradle conda virtualenv
venv pytest nuxt astro tauri
`;
