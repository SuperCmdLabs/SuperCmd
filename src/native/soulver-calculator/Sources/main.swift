import Foundation
import SoulverCore

// NDJSON request/response protocol on stdin/stdout.
//
// Request:  {"id": <number>, "expr": "<string>"}
// Response: {"id": <number>, "value": "<string>", "raw": <number|null>,
//            "type": "<math|unit|currency|percentage|date|duration|string|unknown>",
//            "error": "<string|null>"}
//
// One long-lived process per launcher. Requests arrive one per line.

let calculator: Calculator = {
    var customization = EngineCustomization.standard
    // Fetch ECB currency rates in the background; 33 fiat currencies, no API key.
    // SoulverCore falls back to its hardcoded rate table until this resolves.
    customization.currencyRateProvider = ECBCurrencyRateProvider()
    return Calculator(customization: customization)
}()

struct Request: Decodable {
    let id: Int
    let expr: String
}

struct Response: Encodable {
    let id: Int
    let value: String?
    let raw: Double?
    let type: String
    let error: String?
}

let encoder = JSONEncoder()
let decoder = JSONDecoder()
let stdoutHandle = FileHandle.standardOutput
let stderrHandle = FileHandle.standardError

func write(_ response: Response) {
    guard let data = try? encoder.encode(response) else { return }
    stdoutHandle.write(data)
    stdoutHandle.write(Data([0x0A]))
}

func logError(_ message: String) {
    stderrHandle.write(Data("[soulver] \(message)\n".utf8))
}

// Extract a plain Double from numeric EvaluationResult cases for the renderer.
// Non-numeric cases (dates, strings, lists, etc.) return nil and the renderer
// falls back to the formatted stringValue.
func rawDouble(from eval: EvaluationResult) -> Double? {
    switch eval {
    case .decimal(let d), .scientificNotation(let d):
        return NSDecimalNumber(decimal: d).doubleValue
    case .percentage(let p):
        return NSDecimalNumber(decimal: p.decimalValue).doubleValue
    case .binary(let u), .octal(let u), .hex(let u):
        return Double(u)
    case .fraction(let f):
        return NSDecimalNumber(decimal: f.decimalValue).doubleValue
    case .multiplier(let m):
        return NSDecimalNumber(decimal: m.decimalValue).doubleValue
    case .unitExpression(let expr):
        return NSDecimalNumber(decimal: expr.value).doubleValue
    default:
        return nil
    }
}

// Coarse classification for the renderer CalcResult.kind mapping.
func classify(_ result: CalculationResult) -> String {
    switch result.evaluationResult {
    case .decimal, .scientificNotation, .binary, .octal, .hex, .fraction, .multiplier:
        return "math"
    case .percentage:
        return "percentage"
    case .unitExpression(let expr):
        return expr.unit.unitType == .currency ? "currency" : "unit"
    case .unit(let scUnit):
        return scUnit.unitType == .currency ? "currency" : "unit"
    case .unitRate, .decimalRate, .percentageRate, .unitRange:
        return "unit"
    case .date, .iso8601, .timestamp, .datespan:
        return "date"
    case .timespan, .laptime, .frametime, .pace:
        return "duration"
    case .rawString, .boolean:
        return "string"
    default:
        return "math"
    }
}

func evaluate(_ expr: String, id: Int) -> Response {
    let result = calculator.calculate(expr)

    if result.isEmptyResult || result.isFailedResult {
        return Response(id: id, value: nil, raw: nil, type: "unknown",
                        error: result.isFailedResult ? "failed" : "empty")
    }

    return Response(
        id: id,
        value: result.stringValue,
        raw: rawDouble(from: result.evaluationResult),
        type: classify(result),
        error: nil
    )
}

// ─── Main loop ────────────────────────────────────────────────────

setbuf(stdout, nil)

while let line = readLine(strippingNewline: true) {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.isEmpty { continue }

    guard let data = trimmed.data(using: .utf8) else {
        logError("could not encode input line as UTF-8")
        continue
    }

    let request: Request
    do {
        request = try decoder.decode(Request.self, from: data)
    } catch {
        logError("malformed request: \(error.localizedDescription)")
        continue
    }

    let response = evaluate(request.expr, id: request.id)
    write(response)
}
