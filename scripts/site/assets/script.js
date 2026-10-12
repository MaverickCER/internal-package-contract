;(function () {
  "use strict"

  // Mobile nav toggle
  var toggle = document.querySelector(".nav-toggle")
  var nav = document.getElementById("primary-nav")

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var isOpen = nav.classList.toggle("is-open")
      toggle.setAttribute("aria-expanded", String(isOpen))
    })

    // Close the mobile menu after a nav link is activated.
    nav.addEventListener("click", function (event) {
      if (event.target.tagName === "A" && nav.classList.contains("is-open")) {
        nav.classList.remove("is-open")
        toggle.setAttribute("aria-expanded", "false")
      }
    })
  }

  // Copy-to-clipboard for code blocks
  var copyButtons = document.querySelectorAll(".copy-button[data-copy-target]")
  var copyStatus = document.getElementById("copy-status")

  copyButtons.forEach(function (button) {
    var targetId = button.getAttribute("data-copy-target")
    var target = document.getElementById(targetId)
    if (!target) {
      return
    }

    var defaultLabel = button.textContent

    button.addEventListener("click", function () {
      var text = target.textContent

      if (!navigator.clipboard) {
        return
      }

      navigator.clipboard.writeText(text).then(
        function () {
          button.textContent = "Copied"
          // The button's own text change is silent to screen readers -- this
          // is the announcement assistive tech actually hears.
          if (copyStatus) {
            copyStatus.textContent = "Copied to clipboard."
          }
          window.setTimeout(function () {
            button.textContent = defaultLabel
          }, 2000)
        },
        function () {
          // Permission denied or the write rejected -- announce the failure
          // rather than leaving an unhandled rejection and a silent button.
          if (copyStatus) {
            copyStatus.textContent = "Couldn't copy to clipboard."
          }
        },
      )
    })
  })

  // Theme toggle -- persists an explicit choice in localStorage as
  // [data-theme] on <html>; absent that, styles.css's
  // `@media (prefers-color-scheme: dark)` block governs.
  var THEME_STORAGE_KEY = document.documentElement.getAttribute("data-theme-key") || "theme"
  var root = document.documentElement
  var themeToggle = document.getElementById("theme-toggle")
  var themeToggleIcon = themeToggle ? themeToggle.querySelector(".theme-toggle-icon") : null

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
  }

  function currentlyDark() {
    var stored = null
    try {
      stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    } catch (error) {
      // Storage may be unavailable (private browsing, disabled cookies) --
      // fall back to the system preference below, never throw.
    }
    if (stored === "dark") return true
    if (stored === "light") return false
    return systemPrefersDark()
  }

  function applyTheme(isDark) {
    root.setAttribute("data-theme", isDark ? "dark" : "light")
    if (themeToggle) {
      themeToggle.setAttribute("aria-pressed", String(isDark))
    }
    if (themeToggleIcon) {
      themeToggleIcon.textContent = isDark ? "◑" : "◐"
    }
  }

  applyTheme(currentlyDark())

  if (themeToggle) {
    themeToggle.addEventListener("click", function () {
      var next = !currentlyDark()
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light")
      } catch (error) {
        // Non-fatal -- the toggle still works for this page view even if
        // the preference can't be persisted.
      }
      applyTheme(next)
    })
  }

  // Cmd+K / Ctrl+K search over this page's own headings and FAQ questions --
  // no backend, no external service, no build step: the index is built once
  // from the DOM already on the page.
  var searchOverlay = document.getElementById("search-overlay")
  var searchTrigger = document.getElementById("search-trigger")
  var searchInput = document.getElementById("search-input")
  var searchResultsList = document.getElementById("search-results")
  var searchEmpty = document.getElementById("search-empty")

  if (searchOverlay && searchTrigger && searchInput && searchResultsList && searchEmpty) {
    var searchIndex = buildSearchIndex()
    var activeIndex = -1
    var lastFocused = null

    function buildSearchIndex() {
      var entries = []
      document.querySelectorAll("main h2[id], main h3[id]").forEach(function (heading) {
        var section = heading.closest("section")
        var eyebrow = section ? section.querySelector(".section-eyebrow") : null
        entries.push({
          title: heading.textContent.trim(),
          context: eyebrow ? eyebrow.textContent.trim() : "",
          anchor: "#" + heading.id,
        })
      })
      document.querySelectorAll(".faq-item").forEach(function (item, index) {
        var summary = item.querySelector("summary")
        if (!summary) return
        if (!item.id) item.id = "faq-item-" + index
        entries.push({
          title: summary.textContent.trim(),
          context: "FAQ",
          anchor: "#" + item.id,
          isFaq: true,
        })
      })
      return entries
    }

    function openSearch() {
      lastFocused = document.activeElement
      searchOverlay.hidden = false
      searchInput.value = ""
      renderResults("")
      searchInput.focus()
      document.addEventListener("keydown", onDocumentKeydown, true)
    }

    function closeSearch() {
      searchOverlay.hidden = true
      document.removeEventListener("keydown", onDocumentKeydown, true)
      if (lastFocused && typeof lastFocused.focus === "function") {
        lastFocused.focus()
      }
    }

    function renderResults(query) {
      var normalized = query.trim().toLowerCase()
      var matches = normalized
        ? searchIndex.filter(function (entry) {
            return (
              entry.title.toLowerCase().indexOf(normalized) !== -1 ||
              entry.context.toLowerCase().indexOf(normalized) !== -1
            )
          })
        : searchIndex

      searchResultsList.innerHTML = ""
      activeIndex = matches.length > 0 ? 0 : -1

      matches.slice(0, 20).forEach(function (entry, index) {
        var li = document.createElement("li")
        var a = document.createElement("a")
        a.href = entry.anchor
        a.className = "search-result"
        a.id = "search-result-" + index
        a.setAttribute("role", "option")
        a.setAttribute("aria-selected", String(index === activeIndex))

        var titleEl = document.createElement("span")
        titleEl.className = "search-result-title"
        titleEl.textContent = entry.title
        a.appendChild(titleEl)

        if (entry.context) {
          var contextEl = document.createElement("span")
          contextEl.className = "search-result-context"
          contextEl.textContent = entry.context
          a.appendChild(contextEl)
        }

        a.addEventListener("click", function () {
          if (entry.isFaq) {
            var target = document.querySelector(entry.anchor)
            if (target && target.tagName === "DETAILS") target.open = true
          }
          closeSearch()
        })

        li.appendChild(a)
        searchResultsList.appendChild(li)
      })

      searchEmpty.hidden = matches.length !== 0
      searchInput.setAttribute("aria-expanded", String(matches.length > 0))
      updateActiveDescendant()
    }

    function updateActiveDescendant() {
      var options = searchResultsList.querySelectorAll(".search-result")
      options.forEach(function (option, index) {
        option.setAttribute("aria-selected", String(index === activeIndex))
      })
      if (activeIndex >= 0 && options[activeIndex]) {
        searchInput.setAttribute("aria-activedescendant", options[activeIndex].id)
        options[activeIndex].scrollIntoView({ block: "nearest" })
      } else {
        searchInput.removeAttribute("aria-activedescendant")
      }
    }

    function onDocumentKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault()
        closeSearch()
        return
      }
      if (event.key === "Tab") {
        // Minimal focus trap: only the search input is focusable inside the
        // dialog (results are activated via Enter, not Tab), so Tab should
        // never leave the dialog while it's open.
        event.preventDefault()
        searchInput.focus()
      }
    }

    searchInput.addEventListener("keydown", function (event) {
      var options = searchResultsList.querySelectorAll(".search-result")
      if (event.key === "ArrowDown") {
        event.preventDefault()
        if (options.length === 0) return
        activeIndex = (activeIndex + 1) % options.length
        updateActiveDescendant()
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        if (options.length === 0) return
        activeIndex = (activeIndex - 1 + options.length) % options.length
        updateActiveDescendant()
      } else if (event.key === "Enter") {
        event.preventDefault()
        if (activeIndex >= 0 && options[activeIndex]) {
          options[activeIndex].click()
        }
      }
    })

    searchInput.addEventListener("input", function () {
      renderResults(searchInput.value)
    })

    searchOverlay.addEventListener("click", function (event) {
      if (event.target === searchOverlay) {
        closeSearch()
      }
    })

    searchTrigger.addEventListener("click", openSearch)

    document.addEventListener("keydown", function (event) {
      var isMac = /Mac|iPhone|iPod|iPad/.test(navigator.platform || "")
      var modifierPressed = isMac ? event.metaKey : event.ctrlKey
      if (modifierPressed && event.key.toLowerCase() === "k") {
        event.preventDefault()
        if (searchOverlay.hidden) {
          openSearch()
        } else {
          closeSearch()
        }
      }
    })
  }
})()
