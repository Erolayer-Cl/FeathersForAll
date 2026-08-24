# language: es
Característica: Rendir evaluación y recibir retroalimentación
  Como Estudiante
  quiero rendir una evaluación y ver mi retroalimentación inmediatamente al finalizar
  para saber en qué debo reforzar sin esperar la corrección del docente

  Escenario: Rendir una evaluación y recibir feedback inmediato
    Dado que estoy matriculado en el curso "Matemática 8vo Básico" y la evaluación "Prueba Fracciones" está publicada
    Cuando respondo todas las preguntas y envío la evaluación
    Entonces recibo mi puntaje y la retroalimentación de cada pregunta al instante

  Escenario: No se puede rendir dos veces la misma evaluación
    Dado que ya envié mis respuestas a la evaluación "Prueba Fracciones"
    Cuando intento volver a rendir la misma evaluación
    Entonces el sistema me lo impide y me muestra mi resultado anterior

  Escenario: Un estudiante no matriculado no puede acceder a la evaluación
    Dado que no estoy matriculado en el curso "Matemática 8vo Básico"
    Cuando intento acceder a la evaluación "Prueba Fracciones" de ese curso
    Entonces el sistema me deniega el acceso
