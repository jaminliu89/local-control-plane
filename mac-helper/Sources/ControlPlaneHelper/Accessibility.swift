import Foundation

#if canImport(AppKit)
import AppKit
import ApplicationServices
#endif

enum AccessibilityService {
    struct Outline {
        let outline: String
        let nodeCount: Int
    }

    static func outline() -> Outline {
        #if canImport(AppKit)
        let system = AXUIElementCreateSystemWide()
        var focused: CFTypeRef?
        let err = AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused)
        guard err == .success, let focused else {
            return Outline(outline: "Window\n  （没有聚焦控件）", nodeCount: 1)
        }
        var lines: [String] = []
        var count = 0
        walk(element: focused as! AXUIElement, depth: 0, lines: &lines, count: &count, limit: 80)
        return Outline(outline: lines.joined(separator: "\n"), nodeCount: count)
        #else
        return Outline(outline: "Window\n  （非 AppKit 环境）", nodeCount: 1)
        #endif
    }

    static func perform(action: String, target: String, value: String?) throws {
        #if canImport(AppKit)
        guard HelperAuth.accessibilityTrusted() else {
            throw NSError(domain: "helper", code: 10, userInfo: [NSLocalizedDescriptionKey: "需要辅助功能授权"])
        }
        // 第一刀：按标题子串找按钮/输入框；找不到就明确失败。
        let system = AXUIElementCreateSystemWide()
        var focusedApp: CFTypeRef?
        AXUIElementCopyAttributeValue(system, kAXFocusedApplicationAttribute as CFString, &focusedApp)
        guard let focusedApp else {
            throw NSError(domain: "helper", code: 11, userInfo: [NSLocalizedDescriptionKey: "没有聚焦应用"])
        }
        guard let element = find(in: focusedApp as! AXUIElement, matching: target, depth: 0) else {
            throw NSError(domain: "helper", code: 12, userInfo: [NSLocalizedDescriptionKey: "找不到控件 \(target)"])
        }
        switch action {
        case "press":
            let err = AXUIElementPerformAction(element, kAXPressAction as CFString)
            if err != .success {
                throw NSError(domain: "helper", code: 13, userInfo: [NSLocalizedDescriptionKey: "press 失败"])
            }
        case "set_value", "type":
            guard let value else {
                throw NSError(domain: "helper", code: 14, userInfo: [NSLocalizedDescriptionKey: "需要 value"])
            }
            let err = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
            if err != .success {
                throw NSError(domain: "helper", code: 15, userInfo: [NSLocalizedDescriptionKey: "\(action) 失败"])
            }
        default:
            throw NSError(domain: "helper", code: 16, userInfo: [NSLocalizedDescriptionKey: "未知 action"])
        }
        #else
        throw NSError(domain: "helper", code: 17, userInfo: [NSLocalizedDescriptionKey: "非 AppKit 环境"])
        #endif
    }

    #if canImport(AppKit)
    private static func walk(element: AXUIElement, depth: Int, lines: inout [String], count: inout Int, limit: Int) {
        if count >= limit || depth > 6 { return }
        var role: CFTypeRef?
        var title: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
        AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &title)
        let roleText = (role as? String) ?? "Element"
        let titleText = (title as? String) ?? ""
        let pad = String(repeating: "  ", count: depth)
        lines.append("\(pad)\(roleText)\(titleText.isEmpty ? "" : " \(titleText)")")
        count += 1
        var children: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children)
        if let array = children as? [AXUIElement] {
            for child in array.prefix(12) {
                walk(element: child, depth: depth + 1, lines: &lines, count: &count, limit: limit)
            }
        }
    }

    private static func find(in element: AXUIElement, matching needle: String, depth: Int) -> AXUIElement? {
        if depth > 8 { return nil }
        var title: CFTypeRef?
        var value: CFTypeRef?
        var desc: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &title)
        AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value)
        AXUIElementCopyAttributeValue(element, kAXDescriptionAttribute as CFString, &desc)
        let hay = [title as? String, value as? String, desc as? String].compactMap { $0 }.joined(separator: " ")
        if hay.localizedCaseInsensitiveContains(needle) { return element }
        var children: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children)
        if let array = children as? [AXUIElement] {
            for child in array.prefix(20) {
                if let found = find(in: child, matching: needle, depth: depth + 1) { return found }
            }
        }
        return nil
    }
    #endif
}
