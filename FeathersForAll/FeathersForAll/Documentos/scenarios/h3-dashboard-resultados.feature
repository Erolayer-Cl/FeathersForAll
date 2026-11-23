# language: es
Característica: Ver dashboard de resultados
  Como Docente
  quiero ver un dashboard con los resultados agregados de una evaluación
  para identificar rápidamente qué contenidos debo reforzar

  Escenario: Ver el resultado agregado de una evaluación
    Dado que la evaluación "Prueba Fracciones" tiene respuestas registradas de sus estudiantes
    Cuando abro el dashboard del curso
    Entonces veo el puntaje promedio y la distribución de aciertos por pregunta

  Escenario: Ver el detalle de un estudiante en particular
    Dado que el dashboard del curso está abierto
    Cuando filtro los resultados por un estudiante específico
    Entonces veo el detalle de sus respuestas y la retroalimentación que recibió

  Escenario: Dashboard sin respuestas registradas todavía
    Dado que ningún estudiante ha respondido la evaluación "Prueba Fracciones"
    Cuando abro el dashboard del curso
    Entonces el sistema muestra un estado vacío en vez de un error
