import { mkdirSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"

/** Project root directory. */
const ROOT_DIR = resolve(import.meta.dir, "..")

/** Directory that holds the Qdrant binary and its configuration. */
const QDRANT_DIR = join(ROOT_DIR, "qdrant")

/** Static Qdrant binary installed by `bun run init`. */
const QDRANT_BINARY = join(QDRANT_DIR, "qdrant")

/** Qdrant configuration path, relative to the Qdrant directory. */
const QDRANT_CONFIG = "config/config.yaml"

/** Directory for local state that Git ignores. */
const TMP_DIR = join(ROOT_DIR, ".tmp")

/** File that stores the process ID of the Qdrant instance started by this script. */
const PID_FILE = join(TMP_DIR, "qdrant.pid")

/** File that receives the Qdrant server output. */
const LOG_FILE = join(TMP_DIR, "qdrant.log")

/** Maximum time to wait for Qdrant to answer on its HTTP port. */
const START_TIMEOUT_MS = 20_000

/** Maximum time to wait for Qdrant to stop after a termination signal. */
const STOP_TIMEOUT_MS = 15_000

/** Severity of one command-line log line. */
type LogLevel = "info" | "success" | "warning" | "error"

/** Icon that starts each log line for a severity. */
const LOG_ICONS: Record<LogLevel, string> = {
	info: "●",
	success: "✔",
	warning: "▲",
	error: "✖",
}

/** ANSI color of each log line for a severity. */
const LOG_COLORS: Record<LogLevel, string> = {
	info: "cyan",
	success: "green",
	warning: "yellow",
	error: "red",
}

/** Wrap text in an ANSI color when the terminal supports colors. */
const paint = (text: string, color: string): string => {
	if (!Bun.enableANSIColors) {
		return text
	}

	const prefix = Bun.color(color, "ansi-16")

	return prefix === null ? text : `${prefix}${text}\x1b[0m`
}

/** Write one log line with its icon and color. */
const log = (level: LogLevel, message: string): void => {
	const line = `${paint(LOG_ICONS[level], LOG_COLORS[level])} ${message}`

	if (level === "error") {
		console.error(line)

		return
	}

	console.log(line)
}

/** Write one indented detail line, for example a URL. */
const logDetail = (label: string, value: string): void => {
	console.log(`  ${paint("➜", "cyan")} ${label}: ${paint(value, "cyan")}`)
}

/** HTTP settings read from the Qdrant configuration file. */
type QdrantService = {
	/** Host that Qdrant binds to. */
	host: string
	/** HTTP port that serves the REST API and the dashboard. */
	httpPort: number
}

/** URLs that a developer opens in a browser. */
type QdrantUrls = {
	/** REST API root. */
	api: string
	/** Web UI dashboard. */
	dashboard: string
}

/**
 * Read the HTTP host and port from the Qdrant configuration file.
 *
 * The configuration is the source of truth, so a developer who changes the
 * port in `qdrant/config/config.yaml` sees the right URL in the log.
 */
const readService = async (): Promise<QdrantService> => {
	const path = join(QDRANT_DIR, QDRANT_CONFIG)
	const file = Bun.file(path)

	if (!(await file.exists())) {
		throw new Error(`Qdrant configuration not found at ${path}. Run "bun run init".`)
	}

	const config = Bun.YAML.parse(await file.text()) as {
		service?: { host?: unknown; http_port?: unknown }
	}
	const host = typeof config.service?.host === "string" ? config.service.host : "127.0.0.1"
	const httpPort = typeof config.service?.http_port === "number" ? config.service.http_port : 6333

	return { host, httpPort }
}

/** Build the browser URLs from the configured host and port. */
const buildUrls = (service: QdrantService): QdrantUrls => {
	const host = service.host === "0.0.0.0" || service.host === "::" ? "127.0.0.1" : service.host
	const api = `http://${host}:${service.httpPort}`

	return { api, dashboard: `${api}/dashboard` }
}

/** Print the URLs that a developer needs after a start or a status check. */
const printUrls = (urls: QdrantUrls): void => {
	logDetail("Admin dashboard", urls.dashboard)
	logDetail("REST API", urls.api)
}

/** Read the stored process ID, or return null when no valid file exists. */
const readPid = async (): Promise<number | null> => {
	const file = Bun.file(PID_FILE)

	if (!(await file.exists())) {
		return null
	}

	const pid = Number.parseInt((await file.text()).trim(), 10)

	return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

/** Tell whether a process exists. Signal 0 checks existence without killing it. */
const isProcessAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0)

		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM"
	}
}

/** Remove the PID file when it no longer names a running process. */
const removePidFile = (): void => {
	rmSync(PID_FILE, { force: true })
}

/** Ask the Qdrant health endpoint whether the server accepts requests. */
const isHealthy = async (apiUrl: string): Promise<boolean> => {
	try {
		const response = await fetch(`${apiUrl}/healthz`, {
			signal: AbortSignal.timeout(1_000),
		})

		return response.ok
	} catch {
		return false
	}
}

/** Poll the health endpoint until it answers or the timeout expires. */
const waitForHealth = async (apiUrl: string, timeoutMs: number): Promise<boolean> => {
	const deadline = Date.now() + timeoutMs

	while (Date.now() < deadline) {
		if (await isHealthy(apiUrl)) {
			return true
		}

		await Bun.sleep(250)
	}

	return false
}

/** Poll the process table until the process exits or the timeout expires. */
const waitForExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
	const deadline = Date.now() + timeoutMs

	while (Date.now() < deadline) {
		if (!isProcessAlive(pid)) {
			return true
		}

		await Bun.sleep(250)
	}

	return !isProcessAlive(pid)
}

/** Start Qdrant in the background and print its dashboard URL. */
const start = async (): Promise<void> => {
	mkdirSync(TMP_DIR, { recursive: true })
	const service = await readService()
	const urls = buildUrls(service)
	const pid = await readPid()

	if (pid !== null && isProcessAlive(pid)) {
		log("info", `Qdrant is already running (pid ${pid}).`)
		printUrls(urls)

		return
	}

	if (await isHealthy(urls.api)) {
		log("info", "Qdrant is already running (started outside this script).")
		printUrls(urls)

		return
	}

	if (!(await Bun.file(QDRANT_BINARY).exists())) {
		throw new Error(`Qdrant binary not found at ${QDRANT_BINARY}. Run "bun run init".`)
	}

	await Bun.write(LOG_FILE, "")
	const child = Bun.spawn({
		cmd: [QDRANT_BINARY, "--config-path", QDRANT_CONFIG],
		cwd: QDRANT_DIR,
		stdin: "ignore",
		stdout: Bun.file(LOG_FILE),
		stderr: Bun.file(LOG_FILE),
		detached: true,
	})
	const handle = child as unknown as { unref?: () => void }
	handle.unref?.()
	await Bun.write(PID_FILE, `${child.pid}\n`)

	if (!(await waitForHealth(urls.api, START_TIMEOUT_MS))) {
		if (isProcessAlive(child.pid)) {
			child.kill("SIGTERM")
		}

		removePidFile()

		throw new Error(`Qdrant did not become healthy. Read ${LOG_FILE} for the server output.`)
	}

	log("success", `Qdrant started (pid ${child.pid}).`)
	printUrls(urls)
}

/** Stop Qdrant with a clean termination signal. */
const stop = async (): Promise<void> => {
	const service = await readService()
	const urls = buildUrls(service)
	const pid = await readPid()

	if (pid === null) {
		if (await isHealthy(urls.api)) {
			log(
				"error",
				"Qdrant answers but this script did not start it, so it has no PID file to stop. Stop it manually.",
			)
			process.exitCode = 1

			return
		}

		log("info", "Qdrant is not running.")

		return
	}

	if (!isProcessAlive(pid)) {
		removePidFile()
		log("warning", `Removed the stale PID file. Qdrant is not running (pid ${pid}).`)

		return
	}

	process.kill(pid, "SIGTERM")

	if (!(await waitForExit(pid, STOP_TIMEOUT_MS))) {
		log("error", `Qdrant did not stop within ${STOP_TIMEOUT_MS / 1_000} seconds (pid ${pid}).`)
		process.exitCode = 1

		return
	}

	removePidFile()
	log("success", `Qdrant stopped (pid ${pid}).`)
}

/** Run the command named by the first argument. */
const main = async (): Promise<void> => {
	const command = process.argv[2]

	try {
		if (command === "start") {
			await start()
		} else if (command === "stop") {
			await stop()
		} else {
			log("error", "Usage: bun run scripts/qdrant.ts <start|stop>")
			process.exitCode = 1
		}
	} catch (error) {
		log("error", error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	}
}

if (import.meta.main) {
	await main()
}
