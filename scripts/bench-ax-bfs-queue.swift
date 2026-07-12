import Foundation

private struct Node {
  let firstChild: Int
  let childCount: Int
}

private let depthLimit = 8
private let branching = 3
private var nodes: [Node] = []
private var frontier: [(index: Int, depth: Int)] = [(0, 0)]

nodes.reserveCapacity(9_841)
nodes.append(Node(firstChild: -1, childCount: 0))

var frontierIndex = 0
while frontierIndex < frontier.count {
  let (nodeIndex, depth) = frontier[frontierIndex]
  frontierIndex += 1
  guard depth < depthLimit else { continue }

  let firstChild = nodes.count
  for _ in 0..<branching {
    nodes.append(Node(firstChild: -1, childCount: 0))
    frontier.append((nodes.count - 1, depth + 1))
  }
  nodes[nodeIndex] = Node(firstChild: firstChild, childCount: branching)
}

private let roots = [0, 1, 2].filter { $0 < nodes.count }
private let maxDepth = 8
private let maxElements = 240
private let iterations = 20_000

@inline(never)
private func removeFirstTraversal() -> Int {
  var queue = roots.map { ($0, 0) }
  var inspected = 0
  var checksum = 0

  while let (nodeIndex, depth) = queue.first {
    queue.removeFirst()
    inspected += 1
    if inspected > maxElements { break }

    checksum &+= nodeIndex &+ depth
    if depth >= maxDepth { continue }

    let node = nodes[nodeIndex]
    if node.childCount > 0 {
      for offset in 0..<node.childCount {
        queue.append((node.firstChild + offset, depth + 1))
      }
    }
  }
  return checksum
}

@inline(never)
private func cursorTraversal() -> Int {
  var queue = roots.map { ($0, 0) }
  var queueIndex = 0
  var inspected = 0
  var checksum = 0

  while queueIndex < queue.count {
    let (nodeIndex, depth) = queue[queueIndex]
    queueIndex += 1
    inspected += 1
    if inspected > maxElements { break }

    checksum &+= nodeIndex &+ depth
    if depth >= maxDepth { continue }

    let node = nodes[nodeIndex]
    if node.childCount > 0 {
      for offset in 0..<node.childCount {
        queue.append((node.firstChild + offset, depth + 1))
      }
    }
  }
  return checksum
}

@inline(never)
private func measure(_ label: String, _ block: () -> Int) -> (label: String, ms: Double, checksum: Int) {
  var checksum = 0
  let start = DispatchTime.now().uptimeNanoseconds
  for _ in 0..<iterations {
    checksum &+= block()
  }
  let elapsed = DispatchTime.now().uptimeNanoseconds - start
  return (label, Double(elapsed) / 1_000_000.0, checksum)
}

let removeFirstWarmup = removeFirstTraversal()
let cursorWarmup = cursorTraversal()
precondition(removeFirstWarmup == cursorWarmup)

let removeFirst = measure("removeFirst", removeFirstTraversal)
let cursor = measure("cursor", cursorTraversal)

print("nodes=\(nodes.count) roots=\(roots.count) maxDepth=\(maxDepth) maxElements=\(maxElements) iterations=\(iterations)")
print("\(removeFirst.label): \(String(format: "%.2f", removeFirst.ms)) ms checksum=\(removeFirst.checksum)")
print("\(cursor.label): \(String(format: "%.2f", cursor.ms)) ms checksum=\(cursor.checksum)")
print("speedup: \(String(format: "%.2fx", removeFirst.ms / cursor.ms))")
