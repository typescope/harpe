# Jo Language Reference (Quick Guide for Code Generation)

Jo is a statically typed functional programming language with indentation-based
syntax.

## Complete program shape

Programs submitted to `runCode` must use the sandbox namespace and entry point:

```jo
namespace sandbox.guest

import jo.IO.stdout

def runTask(): Unit receives stdout =
  println "hello"
```

## Variables and primitive types

```jo
val x = 42                   // immutable binding, type inferred
val y: Int = 42              // explicit type
var counter = 0              // mutable binding
counter = counter + 1
```

Primitive types are `Int`, `Float`, `Bool`, `Char`, and `String`. Use `None`
from `Option` for an absent value. Use `pass` for no operation.

## Arithmetic and comparison

```jo
x + y
x * y
x % y
x == y
x < y
x >= y
!condition
condition && other
condition || other
```

## Control flow

```jo
if condition then
  doSomething()
else
  doOther()
end

while x > 0 do
  x = x - 1

for item in items do
  println(item)

for i in 1 to 5 do
  println(i)
```

## Functions

```jo
def add(x: Int, y: Int): Int = x + y

def factorial(n: Int): Int =
  if n <= 1 then 1 else n * factorial(n - 1)
```

## Lambdas and collections

```jo
val xs = [1, 2, 3]
val doubled = xs.map(x => x * 2)
val positive = xs.select(x => x > 0)
val total = xs.fold(0, (a, b) => a + b)
println(xs.join(", "))

val m = Map("x" ~ 10)
println(m.get("x"))

val values = (1 to 10).toList()
```

Empty collections need an explicit element type:

```jo
val xs: List[Int] = []
val names = Set.empty[String]
```

## Strings

```jo
val message = "Result: \{x + y}"
val words = message.split(" ")
val number = "42".toInt()
println(message.toUpper())
```

## Option and pattern matching

```jo
val value: Opt[Int] = Some(20)
match value
case Some(n) => println(n)
case None => pass
```

## Common prime-number example

```jo
def isPrime(n: Int): Bool =
  if n < 2 then false
  else
    var divisor = 2
    while divisor * divisor <= n do
      if n % divisor == 0 then return false
      divisor = divisor + 1
    true

def runTask(): Unit receives stdout =
  var n = 9999
  while !isPrime(n) do
    n = n - 1
  println(n)
```
