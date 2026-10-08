import Foundation

/// A like, as GET /api/likes returns it (shared/likes.ts), with the fields
/// the menu bar shows
struct Like: Decodable, Identifiable, Equatable {
  let id: String
  let url: String?
  let text: String
  let list: String?
  let photoUrls: [String]
  let title: String
  let category: String?
  let imageUrl: String?
  let pictureUrl: String?
  let status: String
  let error: String?

  /// Its title, or what to call it until it has one (likeTitle in shared/likes.ts)
  var displayTitle: String {
    if !title.isEmpty { return title }
    if let url {
      return url.replacingOccurrences(
        of: #"^https?://(www\.)?"#, with: "", options: .regularExpression)
    }
    if !text.isEmpty { return String(text.prefix(80)) }
    return "Photo"
  }
}

/// What to save: links become a like each; photos without a link become one
/// like with all of them
struct Draft {
  var links: [URL] = []
  var photos: [Data] = []
  var text = ""

  var isEmpty: Bool { links.isEmpty && photos.isEmpty && text.isEmpty }
}

enum APIError: LocalizedError {
  case wrongKey
  case failed(String)

  var errorDescription: String? {
    switch self {
    case .wrongKey: "That key didn't work"
    case .failed(let message): message
    }
  }
}

/// The likes API on nimo.fyi, with the owner key as a bearer
struct API {
  static let site = URL(string: "https://nimo.fyi")!
  let key: String

  private func request(_ path: String, method: String = "GET") -> URLRequest {
    var request = URLRequest(url: URL(string: path, relativeTo: Self.site)!)
    request.httpMethod = method
    request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
    return request
  }

  private func send(_ request: URLRequest) async throws -> Data {
    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if status == 401 { throw APIError.wrongKey }
    guard (200..<300).contains(status) else {
      let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
      throw APIError.failed(message ?? "The site answered \(status)")
    }
    return data
  }

  /// Every like, newest first
  func likes() async throws -> [Like] {
    struct Response: Decodable { let likes: [Like] }
    return try JSONDecoder().decode(Response.self, from: await send(request("/api/likes"))).likes
  }

  private func save(_ fields: [String: String]) async throws -> Like {
    var request = request("/api/likes", method: "POST")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(fields)
    return try decodeLike(await send(request))
  }

  /// Posts a form with `photo` and any `fields`, to save a like or add a
  /// photo to one
  private func upload(_ path: String, photo: Data, fields: [String: String] = [:]) async throws
    -> Data
  {
    let boundary = "likes-\(UUID().uuidString)"
    var body = Data()
    func append(_ string: String) { body.append(string.data(using: .utf8)!) }
    for (name, value) in fields {
      append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
    }
    append(
      "--\(boundary)\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"photo.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n"
    )
    body.append(photo)
    append("\r\n--\(boundary)--\r\n")

    var request = request(path, method: "POST")
    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    request.httpBody = body
    return try await send(request)
  }

  private func decodeLike(_ data: Data) throws -> Like {
    struct Response: Decodable { let like: Like }
    return try JSONDecoder().decode(Response.self, from: data).like
  }

  /// Saves the draft with my list, note and review; `progress` hears each
  /// request as it starts. Photos go up one request each, to stay under
  /// Vercel's 4.5 MB request limit
  func save(
    _ draft: Draft, list: String?, note: String, review: String,
    progress: (Int, Int) -> Void
  ) async throws {
    var fields = ["note": note, "review": review]
    if let list { fields["list"] = list }
    if !draft.text.isEmpty { fields["text"] = draft.text }

    if !draft.links.isEmpty {
      for (i, link) in draft.links.enumerated() {
        progress(i + 1, draft.links.count)
        _ = try await save(fields.merging(["url": link.absoluteString]) { $1 })
      }
    } else if let first = draft.photos.first {
      let total = draft.photos.count
      progress(1, total)
      let like = try decodeLike(await upload("/api/likes", photo: first, fields: fields))
      for (i, photo) in draft.photos.dropFirst().enumerated() {
        progress(i + 2, total)
        _ = try await upload("/api/likes?op=photo&id=\(like.id)", photo: photo)
      }
    } else {
      progress(1, 1)
      _ = try await save(fields)
    }
  }
}
