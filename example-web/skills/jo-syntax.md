# Jo Language Reference (Quick Guide for Code Generation)

Jo is a statically typed functional programming language with an indentation-based
syntax.

## Example
```jo
import jo.IO.*
def main = 
  // Read a single line from stdin (returns String, strips trailing newline)
  val line = stdin()
  
  // Print with newline
  println("hello")
  // must use parentheses when parameters are complex expression
  println("hello" + line) 
```

## Variables

```jo
val x = 42                   // immutable binding, type inferred
val y: Int = 42              // with explicit type
var counter = 0              // mutable variable must specified with `var`
counter = counter + 1        // mutation
```

## Primitive Types

- `Int`    — integer (arbitrary precision)
- `Float`  — floating point
- `Bool`   — true / false
- `Char`   — character literal `'a'`
- `String` — text

## Null Value and No-op

There's no null value, use `None` from `Option` type to represent empty.
Jo uses `pass` keyword to represent no operation

```Jo
val x: Opt[Int] = Some(20)
match x
  case Some(i) => println(i)
  case None => pass
```

## Arithmetic & Comparison

```jo
// Int arithmetic
x + y
x * y
x % y

// number comparison
x == y
x < y
x >= y

// Bool arithmetic
!cond
cond && cond2
cond || cond2
(cond ||
 cond2)
```

## Control Flow

```jo
// if/else block
if condition then
  doSomething()
else
  doOther()
end

// while loop
while x > 0 do
  x = x - 1

// for loop over a list
for item in items do
  println(item)

// for loop with filter
for x in numbers if x > 0 do
  println(x)
```

## Functions

```jo
def greet(name: String): String = "Hello, " + name
// return type inferred
def add(x: Int, y: Int) = x + y

def factorial(n: Int): Int =
  if n <= 1 then 1 else n * factorial(n - 1)

// generic function
def identity[T](x: T): T = x
```

## Lambdas

```jo
x => x + 1
(x, y) => x + y
(x: Int) => x * 2
() => 42
```


## Immutable ADT

String, List, Map, and Set are all immutable data types. 

### String Operations

most string common operations are listed below, there's no `reverse`, `take`, `drop` method defined on string.

```jo
// concatenation
"hello" + " " + "world"
// number to string
"length: " + n.toString()
// trim whitespace
line.trim()
// split into List[String]
line.split(" ")
// parse Int (throws on failure)
line.toInt()
// parse Float
line.toFloat()
// to lower case
line.toLower()
// to upper case
line.toUpper()
// contains a substring
line.contains(substr)
// get substring by pos and len
line.substring(from, len)
// to char list
line.iterator().toList()
// starts with a prefix
line.startsWith(prefix)
// ends with a suffix
line.endsWith(suffix)
// char at 0
line[0]
```

String interpolation:
unlike other languages, Jo use `\{}` to mark interpolation
```jo
"Hello, \{name}!"
"Result: \{x + y}"
```

Multi-line strings:
```jo
val s = """
  line one
  line two
  """
```

### Lists

```jo
// List literal
val xs = [1, 2, 3]
// empty list needs explicit type annotation
val xs: List[Int] = []
val xs = List.empty[Int]()

// initialize a mutable list variable with 3 elements with value 5
var xs = List.fill(3, 5)

// get list length
xs.length()
// check if list is empty
xs.isEmpty()
// get the third element 
xs.get(3)
// update first element to 9, returns a new list 
xs = xs.updated(0, 9)
// return new list by taking first n elements
xs.take(n)
// return new list by slicing current list from `start` for `len` elements
xs.slice(start, len)
// return new list by dropping first n elements
xs.drop(n)
// map to a new list with lambda
xs.map(x => x * 2)
// filter by predicate, returns List[T]
xs.select(x => x > 0)
// operate on each element in the list
xs.fold(0, (a, b) => a + b)
// contains, check if an element exists
xs.contains(5)
// counts how many elements satisfy the predicate
xs.count(x => x > 0)
// check if any element match the predicate, returns Bool
xs.exists(x => x == 5)
// join elements with separator to produce a string
xs.join(", ")
// return a reversed list
xs.reverse()
// return a sorted list
xs.sort()
// return a new list with element appended
xs = xs + 4
// return a new list with another list appended
xs = xs ++ [4,5]
```

### Map

```jo
val m: Map[String, int] = Map()     // explicit type annotation is required for empty map liberal
Map("a" ~ 1, "b" ~ 2)                 // Map[String, Int]
val m = Map("x" ~ 10)
m["x"]                           // 10
m.get("x")                       // return value of a key or panic
m.getOpt("x")                    // Option[Int]
m.getOrElse("y", 1)              // 1
m.contains("x")                  // Bool
m.add("y", 2)                    // add/update key, value
m.remove("y")                    // remove key entry
m.keys()                         // List[String]
m.values()                       // List[Int]
```

### Set

```jo
val s: Set[Int] = Set()         // explicit type annotation is required for empty set literal
Set(1, 2, 3)                    // literal Int Set
val n = Set.empty[Char]         // empty Set[Char]
n = n + 'A'                     // add element to a set
n - 'A'                         // remove element from set
n.size()                        // set size
n.contains('A')                 // check element exists
n.select(x => x > 'a')          // filter element
n ++ {'B', 'C'}                 // add two set
n & {'A', 'C'}                  // intersections of two sets
```

## Union Type

```jo
union Option[T] = Some(value: T) | None

union List[T] = Cons(head: T, tail: List[T]) | Nil

// Simple enum
union Color = Red | Green | Blue
```

## Pattern Matching

```jo
match expr
  case 0 => "zero"
  case n if n > 0 => "positive"
  case _ => "negative"

// Matching union types
match opt
  case Some(v) => v
  case None    => 0

// Sequence patterns
match xs
  case []              => "empty"
  case [x]             => "singleton"
  case [first, ..rest] => "many"
```

The `is` expression (returns Bool, binds variable in scope):
```jo
if opt is Some(v) then println(v)
```

## Classes

```jo
class Point(x: Int, y: Int)

class Counter
  var count: Int = 0
  def increment(): Unit = count = count + 1
  def get(): Int = count
end

val p = new Point(1, 2) // class instantiation always requires `new`
println(p.x)
```