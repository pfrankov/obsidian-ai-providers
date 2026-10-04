# Пользовательские сценарии

## Отмена потокового ответа на компьютере

Действие: начать потоковый ответ и отменить его до получения заголовков, после заголовков или между фрагментами текста.

Результат: запрос прекращается, ожидающая операция завершается ошибкой отмены; чтение следующего фрагмента не зависает. Повторная отмена безопасна. Отмена чтения тела ответа также останавливает сетевой запрос.

## Завершение потокового ответа

Действие: получить все фрагменты ответа, дождаться завершения чтения и затем отменить ранее использованный контроллер.

Результат: все фрагменты сохранены в исходном порядке, завершённый запрос повторно не отменяется, обработчик сигнала освобождён.

## Хранилище языка временно недоступно

Действие: открыть плагин в окружении, где чтение `localStorage` временно недоступно или выбрасывает исключение.

Результат: интерфейс продолжает работать на английском языке; временная ошибка не сохраняется как постоянный выбор.

## Восстановление сохранённого языка

Действие: после временной ошибки вернуть доступ к `localStorage`, где сохранён язык `ru`, и повторно запросить перевод.

Результат: плагин снова читает настройку и использует русский язык без перезапуска Obsidian.

## Изоляция браузерного хранилища в тестах

Действие: последовательно запустить тесты, которые изменяют `localStorage` или глобальные mocks.

Результат: каждый тест получает исходное jsdom-хранилище без данных и подмен из предыдущего теста.

## Эмбеддинги с частичным кешем и повторяющимися текстами

Действие: передать несколько текстов, включая повторы, когда часть текстов уже есть в кеше; получить несколько обновлений прогресса от провайдера.

Результат: каждый отсутствующий текст отправлен провайдеру один раз. Векторы и прогресс сохраняют порядок и повторы исходного ввода. Прогресс включает кешированные тексты и фактически обработанные тексты, даже если они находятся в конце ввода.

## Прогресс поиска по документам

Действие: выполнить поиск по документам с одинаковым содержимым или ID, повторной ссылкой на тот же объект, пустому документу и документу с несколькими фрагментами.

Результат: прогресс различает объекты документов, сохраняет повторные ссылки и отмечает документ готовым только после обработки всех его фрагментов. Пустой документ не отмечается обработанным. Число результатов и ссылки на исходные документы сохраняются.

## Отмена эмбеддингов и поиска

Действие: отменить запрос во время чтения кеша, работы провайдера, записи кеша или из последнего обработчика прогресса.

Результат: при проверке сигнала отмены сервис отклоняет запрос с `Error('Aborted')`, без последующих уведомлений о прогрессе и успешного результата. Если провайдер сам отклонил запрос эмбеддингов, может быть передана его исходная ошибка. Уже завершённые записи кеша не откатываются.

## Смена адреса или типа провайдера

Действие: после заполнения кеша изменить URL или тип провайдера, сохранив ID и название модели.

Результат: новые запросы не используют векторы прежней конфигурации. Переименование провайдера и смена API-ключа сохраняют попадания в кеш. Старые записи без сведений об адресе остаются в хранилище, но не используются: при следующем запросе текст будет снова отправлен текущему провайдеру для расчёта, что может повлечь расходы. Фонового пересчёта и запросов к провайдеру при запуске нет.

## Одновременная запись эмбеддингов

Действие: одновременно рассчитать эмбеддинги запроса и документов, затем повторить те же обращения.

Результат: кеш сохраняет новые тексты обоих вызовов независимо от порядка завершения, и повторные обращения не требуют расчёта. Ошибка или откат транзакции кеша не мешает вернуть уже рассчитанные векторы. Одновременные запросы одного отсутствующего текста всё ещё могут рассчитать его отдельно.

## Reasoning modes: real Obsidian smoke test

Use only the authorized isolated vault in real Obsidian with its normal sandbox.
Do not use personal notes, real API keys or existing provider configurations.
Install the exact cloud-built AI Providers and example-plugin candidates; do not
rebuild or install dependencies on the native executor. Verify installed hashes.

1. Run `node test-utils/reasoning-fixture.cjs` using the existing Node runtime.
   It prints a loopback endpoint and safe request-shape records. Streaming is
   synthetic and cannot establish real-provider latency or model acceptance.
2. Add a Z.AI provider with that endpoint, synthetic key `fixture`, and model
   `fixture-alpha`. Its available vocabulary is low/high/max. Select only low
   and high. Add an OpenAI provider for the same endpoint/model; its vocabulary
   is none/minimal/low/medium/high/xhigh/max. Select none/xhigh/max manually.
   These are transport choices, not discovered model capabilities.
3. Save, reopen, run Check and verify the manual selections remain. Edit a mode
   while Check is pending: the edit must survive. Verify keyboard focus, duplicate
   isolation and persistence after restarting the test vault.
4. Switch each provider to `fixture-beta`: the checkbox vocabulary must be
   identical, with no modes selected for this new model. Configure a different
   subset. Returning to alpha must restore alpha's own saved declarations.
   Changing provider type deliberately clears the capability map. Model names
   never choose modes or alter sampling/tools.
5. In Example choose API default and each declared mode. Only declared modes
   should be offered. Verify wire omission for default, and literal none/xhigh/max
   for OpenAI and low/high for Z.AI. No reasoningMode key may leak to the wire.
   Temperature must remain as supplied; Example does not supply it, so the wire
   record must omit it, including with non-none modes.
   Streaming must complete and Execute must recover. Endpoint incompatibilities
   must surface; do not substitute modes or silently remove sampling.
6. Capture normal and narrower settings views and the Example selector. Verify no
   blank control region, clipping, horizontal overflow or inaccessible Save/Cancel.
   Move the cursor outside the capture before taking final screenshots: release
   crops must contain NO cursor. Use only synthetic content and these exact builds.
7. Report source SHA, installed hashes, app/platform versions, per-route wire
   records, persistence results, screenshot artifacts and any failures. Stop the
   fixture. Prior-head screenshots and tests are not current-head acceptance.
8. After SDK publication and cloud integration, LocalGPT requires its own exact-head
   native run: provider defaults, action inheritance/API default, per-request
   override/reset, final provider/model/vision selection, streaming/cancel/retry.
   Verify unset Creativity and API default omit temperature; explicit zero and
   other numeric values remain unchanged. Action inheritance must use an explicit
   global choice, while action API default overrides it with omission. No model-name
   condition may affect this behavior.
