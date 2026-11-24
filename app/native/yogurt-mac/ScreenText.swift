import Foundation
import Vision

func screenText(at path: String) throws -> String {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.automaticallyDetectsLanguage = true
  try VNImageRequestHandler(url: URL(fileURLWithPath: path)).perform([request])
  let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
  return String(lines.joined(separator: "\n").prefix(48_000))
}
